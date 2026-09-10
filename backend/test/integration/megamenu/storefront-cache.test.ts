import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { MegamenuCache } from '../../../../packages/modules/megamenu/src/backend/services/megamenu-cache.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * T083 — Storefront cache integration. Verifies:
 *   1. First /by-channel populates Redis at the documented key.
 *   2. Mutating the underlying row out-of-band, then reading again,
 *      returns the cached payload (proves the second read did not hit
 *      the DB).
 *   3. Patching through the service drops the namespace; next read
 *      rebuilds.
 *   4. Activating a different megamenu in the scope drops the key
 *      for that scope so the swap is visible.
 */
describe('Megamenu storefront cache (T083)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let defaultChannelCode: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    defaultChannelCode = channel.code;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seedAndActivate(label: string): Promise<{ id: string; version: number }> {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: `Cache ${label}` }),
    });
    const menu = (create.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        items: [
          {
            parentId: null,
            position: 0,
            kind: 'external-link',
            labels: { 'en-US': label },
            target: { url: `https://example.com/${label}` },
          },
        ],
        version: menu.version,
      }),
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/bindings`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/activate`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ salesChannelId: defaultChannelId, language: 'en-US' }),
    });
    return menu;
  }

  it('caches the resolved payload and invalidates on mutating writes', async () => {
    expect(h.megamenu.cache).toBeDefined();
    if (h.megamenu.cache) await h.megamenu.cache.invalidateAll();

    const menu = await seedAndActivate('A');

    const cacheKey = MegamenuCache.composeKey(defaultChannelCode, 'en-US');
    expect(await h.redis.exists(cacheKey)).toBe(0);

    const first = await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=en-US',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(first.statusCode).toBe(200);
    expect(await h.redis.exists(cacheKey)).toBe(1);

    // Out-of-band rewrite — change the label directly in DB.
    await h.em().getConnection().execute(
      `update megamenu_items set labels = '{"en-US": "MUTATED"}'::jsonb where megamenu_id = ?`,
      [menu.id],
    );

    const second = await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=en-US',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    const secondLabel = (second.json() as { data: { items: Array<{ label: string }> } }).data.items[0]?.label;
    expect(secondLabel).toBe('A');

    // Patching through the service invalidates the namespace.
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/megamenu/menus/${menu.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: 'Renamed' }),
    });
    expect(patch.statusCode).toBe(200);
    expect(await h.redis.exists(cacheKey)).toBe(0);

    const third = await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=en-US',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    const thirdLabel = (third.json() as { data: { items: Array<{ label: string }> } }).data.items[0]?.label;
    expect(thirdLabel).toBe('MUTATED');
  });

  it('activate drops the cache for the scope so the swap is visible immediately', async () => {
    if (h.megamenu.cache) await h.megamenu.cache.invalidateAll();
    const menuA = await seedAndActivate('AA');
    expect(menuA.id).toBeDefined();

    // Warm the cache.
    await h.app.inject({
      method: 'GET',
      url: '/api/v1/megamenu/by-channel?language=en-US',
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    const cacheKey = MegamenuCache.composeKey(defaultChannelCode, 'en-US');
    expect(await h.redis.exists(cacheKey)).toBe(1);

    // Activate a different menu in the scope.
    const menuB = await seedAndActivate('BB');
    expect(menuB.id).toBeDefined();

    expect(await h.redis.exists(cacheKey)).toBe(0);
  });
});
