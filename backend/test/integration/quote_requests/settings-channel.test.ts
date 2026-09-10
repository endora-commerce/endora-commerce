import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { registerValues } from '@endora-commerce/platform/composition';
import {
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
  SettingValueShapeMismatch,
} from '../../../src/kernel/index.js';
import { QUOTE_REQUESTS_SETTING_CODES } from '../../../../packages/modules/quote_requests/src/manifest.js';
import { QuoteRequest } from '../../helpers/package-entities.js';
import type { QuoteRequestsCradle } from '../../../../packages/modules/quote_requests/src/backend/index.js';

/**
 * Regression — `quote_requests` reads its own settings against the **resolved
 * sales channel**.
 *
 * The module used to pass the literal `'default'` as the `salesChannelId`.
 * That is a channel *code*, not an id: `setting_values.sales_channel_id` is
 * `uuid`, so every read failed in the driver
 * (`invalid input syntax for type uuid: "default"`), a bare `catch` swallowed
 * it, and all four settings answered with their module fallback forever —
 * expiry never applied, RFQ numbers never carried the configured prefix or
 * suffix, and switching a storefront flag off did nothing.
 *
 * The tests below therefore assert *configured* values winning, plus the two
 * degraded paths the narrowed handler is entitled to: no resolvable channel
 * (warned once per process) and a setting that is not registered (quiet).
 */
describe('quote_requests settings resolve against the request channel', () => {
  let h: BackendServerHandle;
  const customerCookie = { b2b_session: 'stub-customer-session' };
  const actor = { actorAdminUserId: null };
  const C = QUOTE_REQUESTS_SETTING_CODES;
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

  const handle = (): ReturnType<QuoteRequestsCradle['quoteRequests']['handle']> =>
    (h.container.cradle as unknown as QuoteRequestsCradle).quoteRequests.handle();

  /** Create a Pending RFQ and backdate it past any sane expiry threshold. */
  async function createBackdatedRfq(): Promise<string> {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: customerCookie,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    await h.em().nativeUpdate(
      QuoteRequest,
      { id },
      { updatedAt: new Date(Date.now() - 30 * 86_400_000) },
    );
    return id;
  }

  async function statusOf(id: string): Promise<string> {
    const rfq = await h.em().findOne(QuoteRequest, { id });
    return rfq?.status ?? 'missing';
  }

  /** Swap a container value for the duration of `run`, then put the original back. */
  async function withRegistration<T>(
    name: string,
    replacement: unknown,
    run: () => Promise<T>,
  ): Promise<T> {
    const original = h.container.cradle[name];
    registerValues(h.container, { [name]: replacement });
    try {
      return await run();
    } finally {
      registerValues(h.container, { [name]: original });
    }
  }

  /** A settings port that fails every read the same way. */
  function throwingSettingsPort(error: Error): unknown {
    return {
      get: async (): Promise<never> => {
        throw error;
      },
      getMany: async (): Promise<Map<string, unknown>> => new Map<string, unknown>(),
    };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await h.settings.adminService.setValueForAllChannels(C.EXPIRY_DAYS, 0, null, actor);
    await h.settings.adminService.setValueForAllChannels(C.BUSINESS_ID_PREFIX, '', null, actor);
    await h.settings.adminService.setValueForAllChannels(C.BUSINESS_ID_SUFFIX, '', null, actor);
    await h.settings.adminService.setValueForAllChannels(
      C.SHOW_ADD_TO_QUOTE_ON_CARD,
      true,
      null,
      actor,
    );
    await teardownBackendServer(h);
  });

  it('honours a configured quote_requests.expiry_days', async () => {
    await h.settings.adminService.setValueForAllChannels(C.EXPIRY_DAYS, 14, null, actor);
    await settle();

    const id = await createBackdatedRfq();
    const result = await handle().expiryWorker.sweep();

    expect(result.expiredCount).toBeGreaterThanOrEqual(1);
    expect(await statusOf(id)).toBe('Expired');
  });

  it('stamps a generated RFQ number with the configured prefix and suffix', async () => {
    await h.settings.adminService.setValueForAllChannels(C.BUSINESS_ID_PREFIX, 'RFQ-', null, actor);
    await h.settings.adminService.setValueForAllChannels(C.BUSINESS_ID_SUFFIX, '/2026', null, actor);
    await settle();

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: customerCookie,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }] },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;

    const rfq = await h.em().findOne(QuoteRequest, { id });
    expect(rfq?.businessId).toMatch(/^RFQ-\d+\/2026$/);
  });

  it('honours a storefront flag switched off by the operator', async () => {
    await h.settings.adminService.setValueForAllChannels(
      C.SHOW_ADD_TO_QUOTE_ON_CARD,
      false,
      null,
      actor,
    );
    await settle();

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/settings/quote-requests',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { showAddToQuoteOnCard: boolean } };
    expect(body.data.showAddToQuoteOnCard).toBe(false);
  });

  it('falls back to the module default and warns once when no channel resolves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withRegistration('settingsChannelResolver', async () => null, async () => {
        // Two requests, four reads: the guard is per process, not per read.
        for (let i = 0; i < 2; i += 1) {
          const res = await h.app.inject({
            method: 'GET',
            url: '/api/v1/storefront/settings/quote-requests',
          });
          const body = res.json() as { data: { showAddToQuoteOnCard: boolean } };
          // `false` is configured; with no channel the module default wins.
          expect(body.data.showAddToQuoteOnCard).toBe(true);
        }
      });
      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(lines.filter((l) => l.includes('[quote_requests]'))).toHaveLength(1);
      expect(lines.join('\n')).toContain('sales channel');
    } finally {
      warn.mockRestore();
    }
  });

  it('falls back quietly when the setting is not registered yet', async () => {
    const id = await createBackdatedRfq();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withRegistration(
        'settingsReadPort',
        throwingSettingsPort(new SettingNotRegistered(C.EXPIRY_DAYS)),
        async () => {
          // Falls back to 0 = auto-expiry disabled, so the backdated RFQ stays.
          const result = await handle().expiryWorker.sweep();
          expect(result.expiredCount).toBe(0);
        },
      );
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain('[quote_requests]');
    } finally {
      warn.mockRestore();
    }
    expect(await statusOf(id)).toBe('Pending');
  });

  it('warns once and falls back when the setting is out of scope for the channel', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withRegistration(
        'settingsReadPort',
        throwingSettingsPort(new SettingOutOfScopeForChannel(C.EXPIRY_DAYS, 'channel-id')),
        async () => {
          const result = await handle().expiryWorker.sweep();
          expect(result.expiredCount).toBe(0);
          await handle().expiryWorker.sweep();
        },
      );
      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(lines.filter((l) => l.includes('[quote_requests]'))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('propagates a stored value that does not match the schema instead of degrading', async () => {
    await withRegistration(
      'settingsReadPort',
      throwingSettingsPort(new SettingValueShapeMismatch(C.EXPIRY_DAYS, [])),
      async () => {
        await expect(handle().expiryWorker.sweep()).rejects.toThrow(SettingValueShapeMismatch);
      },
    );
  });
});
