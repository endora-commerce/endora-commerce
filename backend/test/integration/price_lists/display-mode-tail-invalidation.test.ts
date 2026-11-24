import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Setting, SettingValue } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Organization } from '../../helpers/package-entities.js';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import type { PriceListsModuleHandle } from '../../../../packages/modules/price_lists/src/backend/plugin.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Review 2, finding 4 (release 0.108.0) — the price-book engine memoises the
 * viewer's tail of the display-mode chain (the organization override, then the
 * `pricing.*` display-mode settings) under the pricing generation
 * (`BookPricing`'s `ViewerModeKey`). That is correct only while every write the
 * tail reads bumps the generation, which is what this file holds:
 *
 *  - an organization override (`upsertDisplayModeOverride`) — it always did;
 *  - `PriceListService.setSettingsDisplayMode` — it did not;
 *  - the settings admin API writing either `pricing.*` display-mode key, which
 *    `price_lists` hears as `settings.value_changed` — nothing listened.
 *
 * A settings write of any other code must not clear the pricing caches.
 */
describe('price_lists — every write the display-mode tail reads bumps the pricing generation', () => {
  let h: BackendServerHandle;
  const platformAdmin = { b2b_session: 'stub-admin-session' };

  const handle = (): PriceListsModuleHandle =>
    (h.container as unknown as { resolve<T>(name: string): T }).resolve<{ handle: PriceListsModuleHandle }>('priceLists')
      .handle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const em = h.em().fork();
    const settings = await em.find(Setting, { code: { $like: 'pricing.%' } });
    for (const value of await em.find(SettingValue, { setting: { $in: settings.map((s) => s.id) } })) em.remove(value);
    for (const setting of settings) setting.globalValue = null;
    await em.flush();
  });

  /** Resolves once `bump` has been called (or after `ms`, with whatever it saw). */
  async function bumpsDuring(work: () => Promise<void>, ms = 1_000): Promise<unknown[][]> {
    const bump = vi.spyOn(handle().pricingGeneration, 'bump');
    await work();
    const deadline = Date.now() + ms;
    while (bump.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return bump.mock.calls;
  }

  it('an organization display-mode override bumps it', async () => {
    const em = h.em().fork();
    const org = em.create(Organization, {
      name: 'Tail Org',
      taxId: `TAIL-${Date.now() % 10_000_000}-${Math.floor(Math.random() * 1000)}`,
      vatStatus: 'vat_payer',
      status: 'active',
      registeredAddress: { street: 'X', city: 'X', postalCode: 'X', country: 'PL' },
    });
    await em.persist(org).flush();
    const calls = await bumpsDuring(() => handle().priceListService.upsertDisplayModeOverride('organization', org.id, 'both').then(() => undefined));
    expect(calls).toEqual([[{ kind: 'none' }]]);
  });

  it('setSettingsDisplayMode bumps it', async () => {
    const generation = { invalidateAll: vi.fn() };
    const svc = new PriceListService(h.em, generation, neighbourReadPorts(h.em));
    await svc.setSettingsDisplayMode('unauthenticated_display_mode', 'none');
    expect(generation.invalidateAll).toHaveBeenCalledWith({ kind: 'none' });
  });

  it.each(['pricing.default_display_mode', 'pricing.unauthenticated_display_mode'])(
    'a settings admin write of %s bumps it',
    async (code) => {
      const calls = await bumpsDuring(async () => {
        const put = await h.app.inject({
          method: 'PUT',
          url: `/api/v1/admin/settings/${code}/value`,
          cookies: platformAdmin,
          payload: { scope: 'all', value: 'net_only' },
        });
        expect(put.statusCode, put.body).toBe(200);
      });
      expect(calls).toEqual([[{ kind: 'none' }]]);
    },
  );

  it('a settings admin write of another code does not', async () => {
    const calls = await bumpsDuring(async () => {
      const put = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings/admin.idle_logout_minutes/value',
        cookies: platformAdmin,
        payload: { scope: 'all', value: 30 },
      });
      expect(put.statusCode, put.body).toBe(200);
    }, 400);
    expect(calls).toEqual([]);
  });
});
