import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../../src/modules/assets_library/entities/asset.entity.js';
import { Category } from '../../../src/modules/catalog/entities/category.entity.js';

/**
 * T086 — Contract test: PATCH category with mainImageAssetId.
 *
 * Verifies the admin can set / clear a Category's main image and that
 * deletion of the referenced asset is blocked by the registered descriptor.
 */

describe('category main image (T086)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'us1-catalog' });
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('PATCH /admin/catalog/categories/:id with mainImageAssetId persists the link + blocks asset deletion', async () => {
    // Seed an asset.
    const em = h.em();
    const asset = em.create(Asset, {
      kind: 'image',
      filename: 'cat-banner.png',
      mimeType: 'image/png',
      sizeBytes: '0',
      storageUrl: 'https://example.com/banner.png',
      storageLocator: 'https://example.com/banner.png',
      storageBackend: 'legacy',
      visibility: 'public',
    });
    await em.persistAndFlush(asset);

    // Pick a category from the seed.
    const category = await em.findOneOrFail(Category, { deletedAt: null });
    const r = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/categories/${category.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ mainImageAssetId: asset.id }),
    });
    expect(r.statusCode).toBe(200);
    const data = (r.json() as { data: { mainImageAssetId: string } }).data;
    expect(data.mainImageAssetId).toBe(asset.id);

    // Try to soft-delete the asset → should be blocked by reference protection.
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/assets/${asset.id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(409);
    expect(del.json()).toMatchObject({ error: { code: 'ASSET_REFERENCED' } });

    // Cleanup: clear the main image, then delete asset.
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/categories/${category.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ mainImageAssetId: null }),
    });
    const fresh = h.em().fork({ clear: true });
    await fresh.removeAndFlush(await fresh.findOneOrFail(Asset, { id: asset.id }));
  });
});
