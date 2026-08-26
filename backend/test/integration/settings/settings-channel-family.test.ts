import { Cart, CartItem } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { z } from 'zod';

import { defineModuleSettingsManifest } from '@endora-commerce/contracts';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';

import {
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
  SettingsChannelIdInvalid,
} from '../../../src/kernel/settings/settings.service.js';

import { Setting } from '../../../src/kernel/settings/setting.entity.js';

import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

import { CARTS_SETTING_CODES } from '../../../../packages/modules/carts/src/manifest.js';

import { SEARCH_SETTING_CODES } from '../../../../packages/modules/search/src/manifest.js';

import { QUICK_ORDER_SETTING_CODES } from '../../../../packages/modules/quick_order/src/manifest.js';

import type { CartsCradle } from '../../../../packages/modules/carts/src/backend/index.js';
import type { SearchCradle } from '../../../../packages/modules/search/src/backend/index.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';


/**
 * Regression — the settings-channel defect family (feature 072, D-41/D-42/D-43).
 *
 * `setting_values.sales_channel_id` is a `uuid` column. Six reads passed the
 * literal `'default'` — a channel **code**, the value of
 * `DEFAULT_SALES_CHANNEL_CODE` — where an id was wanted, so PostgreSQL rejected
 * the comparison outright (`invalid input syntax for type uuid: "default"`).
 * Every one of those reads sat inside a bare `catch` returning a compiled-in
 * constant, so a malformed query was indistinguishable from "not configured
 * yet" and three settings were ignored on every deployment.
 *
 * The three live ones are pinned here **by behaviour**, not by the argument
 * they pass: with the setting configured, cart-abandonment sweeping sweeps, the
 * search reindex interval is the configured one, and the quick-order row cap
 * applies. The kernel half — a platform-wide read (`null`), an unresolvable
 * channel, an unregistered code and a malformed channel id — is pinned
 * alongside, because that tier is what the six sites were reaching for and
 * had no spelling for.
 */
describe('settings reads name a real channel or say they have none', () => {
  let h: BackendServerHandle;
  const actor = { actorAdminUserId: null };
  /** Cache invalidation rides the in-process EventBus; let it land. */
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await h.settings.adminService.setValueForAllChannels(
      CARTS_SETTING_CODES.ABANDONMENT_INACTIVITY_MINUTES,
      10080,
      null,
      actor,
    );
    await h.settings.adminService.setValueForAllChannels(
      SEARCH_SETTING_CODES.REINDEX_INTERVAL_MINUTES,
      10,
      null,
      actor,
    );
    await h.settings.adminService.setValueForAllChannels(
      QUICK_ORDER_SETTING_CODES.IMPORT_MAX_ROWS,
      2000,
      null,
      actor,
    );
    await teardownBackendServer(h);
  });

  // -------------------------------------------------------------------------
  // The three settings that were ignored on every deployment.
  // -------------------------------------------------------------------------

  it('sweeps abandoned carts at the configured carts.abandonment.inactivity_minutes', async () => {
    // 10 minutes, so a cart idle for 30 is eligible. The pre-fix read threw in
    // the driver, the `catch` answered `0`, and the worker treats `<= 0` as
    // "sweep nothing" — the divergent fallback inverted the feature.
    await h.settings.adminService.setValueForAllChannels(
      CARTS_SETTING_CODES.ABANDONMENT_INACTIVITY_MINUTES,
      10,
      null,
      actor,
    );
    await settle();

    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    const token = `anon-scfam-${Date.now()}`;
    const cartId = await withSystemScope('test: seed abandoned-cart candidate', async () => {
      const em = h.em();
      const cart = em.create(Cart, {
        anonymousCartToken: token,
        salesChannelId: channel.id,
        lastActivityAt: new Date(Date.now() - 30 * 60_000),
      });
      await em.persistAndFlush(cart);
      em.create(CartItem, {
        cartId: cart.id,
        productId: '00000000-0000-4000-8000-000000000101',
        quantity: 1,
        unitPrice: '12.50',
        currency: 'PLN',
      });
      await em.flush();
      return cart.id;
    });

    const worker = (h.container.cradle as unknown as CartsCradle).cartAbandonmentWorker;
    const result = await worker.sweep();

    expect(result.abandonedCount).toBeGreaterThanOrEqual(1);
    const reload = await withSystemScope('test: reload swept cart', async () =>
      h.em().findOneOrFail(Cart, { id: cartId }),
    );
    expect(reload.status).toBe('abandoned');
  });

  it('honours a configured search.reindex_interval_minutes', async () => {
    await h.settings.adminService.setValueForAllChannels(
      SEARCH_SETTING_CODES.REINDEX_INTERVAL_MINUTES,
      37,
      null,
      actor,
    );
    await settle();

    const handle = (h.container.cradle as unknown as SearchCradle).searchHandle;
    expect(await handle.resolveReindexIntervalMinutes()).toBe(37);
  });

  it('applies a configured quick_order.import_max_rows to an import', async () => {
    await h.settings.adminService.setValueForAllChannels(
      QUICK_ORDER_SETTING_CODES.IMPORT_MAX_ROWS,
      1,
      null,
      actor,
    );
    await settle();

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/import',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        csv: ['sku,quantity', 'EXAMPLE-SIMPLE-001,1', 'EXAMPLE-BLUE-002,2'].join('\n'),
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { summary: { truncated: boolean }; rejected: Array<{ reason: string }> };
    };
    expect(body.data.summary.truncated).toBe(true);
    expect(body.data.rejected.map((r) => r.reason)).toContain('row_limit_exceeded');
  });

  // -------------------------------------------------------------------------
  // The read tier those six sites were reaching for: platform-wide (`null`).
  // -------------------------------------------------------------------------

  describe('platform-wide reads', () => {
    beforeAll(async () => {
      await new ManifestReconciler(h.em()).apply([
        defineModuleSettingsManifest({
          moduleCode: 'scfam',
          groups: [],
          settings: [
            {
              code: 'scfam.global',
              name: 'Global',
              valueType: 'string',
              defaultValue: 'manifest-default',
            },
            {
              code: 'scfam.scoped',
              name: 'Scoped',
              valueType: 'string',
              defaultValue: 'scoped-default',
              salesChannelCodes: ['pl_retail'],
            },
          ],
        }),
      ]);
    });

    afterAll(async () => {
      const em = h.em();
      for (const s of await em.find(Setting, { ownerModule: 'scfam' })) em.remove(s);
      await em.flush();
    });

    it('resolves the manifest default when nothing is configured', async () => {
      expect(
        await h.settings.settingsService.get('scfam.global', null, z.string()),
      ).toBe('manifest-default');
    });

    it('resolves the operator global override, not a per-channel one', async () => {
      await h.settings.adminService.setValueForAllChannels(
        'scfam.global',
        'platform-wide',
        null,
        actor,
      );
      await h.settings.adminService.setValueForSubset(
        'scfam.global',
        ['pl_retail'],
        'per-channel',
        null,
        actor,
      );
      await settle();

      const channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
      expect(await h.settings.settingsService.get('scfam.global', null, z.string())).toBe(
        'platform-wide',
      );
      // The per-channel value is a different cache key, not a collision.
      expect(
        await h.settings.settingsService.get('scfam.global', channel.id, z.string()),
      ).toBe('per-channel');
    });

    it('has no answer for a setting scoped to a subset of channels', async () => {
      await expect(
        h.settings.settingsService.get('scfam.scoped', null, z.string()),
      ).rejects.toBeInstanceOf(SettingOutOfScopeForChannel);
    });

    it('still throws SettingNotRegistered for an unknown code', async () => {
      await expect(
        h.settings.settingsService.get('scfam.nope', null, z.string()),
      ).rejects.toBeInstanceOf(SettingNotRegistered);
    });

    it('reports platform-wide reads through getMany as well', async () => {
      const out = await h.settings.settingsService.getMany(
        ['scfam.global', 'scfam.scoped', 'scfam.nope'],
        null,
      );
      expect(out.get('scfam.global')).toEqual({ ok: true, value: 'platform-wide' });
      expect(out.get('scfam.scoped')).toEqual({ ok: false, error: 'out_of_scope' });
      expect(out.get('scfam.nope')).toEqual({ ok: false, error: 'not_registered' });
    });
  });

  // -------------------------------------------------------------------------
  // D-42's seam guard: a channel id that is not one never reaches the driver.
  // -------------------------------------------------------------------------

  describe('a malformed channel id is refused at the seam', () => {
    it('rejects a channel code where an id was wanted', async () => {
      const err = await h.settings.settingsService
        .get(CARTS_SETTING_CODES.ABANDONMENT_INACTIVITY_MINUTES, 'default', z.number())
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err).toBeInstanceOf(SettingsChannelIdInvalid);
      expect((err as SettingsChannelIdInvalid).salesChannelId).toBe('default');
    });

    it('rejects the empty string', async () => {
      await expect(
        h.settings.settingsService.get(
          CARTS_SETTING_CODES.ABANDONMENT_INACTIVITY_MINUTES,
          '',
          z.number(),
        ),
      ).rejects.toBeInstanceOf(SettingsChannelIdInvalid);
    });

    it('propagates out of getMany rather than being reported per code', async () => {
      await expect(
        h.settings.settingsService.getMany(
          [CARTS_SETTING_CODES.ABANDONMENT_INACTIVITY_MINUTES],
          'default',
        ),
      ).rejects.toBeInstanceOf(SettingsChannelIdInvalid);
    });
  });

  // -------------------------------------------------------------------------
  // D-41 point 2 — the resolver answers with a channel id or with "none".
  // The degrade a `null` obliges a channel-scoped reader to is covered by
  // `test/integration/quote_requests/settings-channel.test.ts`, which owns the
  // warn-once shape D-43 makes the rule.
  // -------------------------------------------------------------------------

  it('resolves a real channel id or null, never a placeholder', async () => {
    const { settingsChannelResolver } = h.container.cradle as unknown as {
      settingsChannelResolver: () => Promise<string | null>;
    };
    const resolved = await settingsChannelResolver();
    expect(resolved).not.toBeNull();
    await expect(
      h.settings.settingsService.get('scfam.absent.code', resolved, z.string()),
    ).rejects.toBeInstanceOf(SettingNotRegistered);
  });
});
