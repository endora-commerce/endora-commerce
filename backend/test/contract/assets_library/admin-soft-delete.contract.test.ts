import { Asset } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';


/**
 * T056 / T067 — Contract test: soft-delete + restore + reference protection.
 *
 * Verifies that DELETE /api/v1/admin/assets/:id:
 *   - Soft-deletes an unreferenced asset (sets deletedAt + purgeAfterAt).
 *   - Returns 409 ASSET_REFERENCED with details for an asset still in use
 *     (Catalog gallery descriptor — registered by composition).
 *   - And POST /api/v1/admin/assets/:id/restore clears the soft-delete state.
 */

describe('admin soft-delete + reference protection (T056)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'us1-catalog' });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('soft-deletes an unreferenced asset (200) and restores it', async () => {
    const em = h.em();
    const a = em.create(Asset, {
      kind: 'image',
      filename: 'soft-delete-me.png',
      mimeType: 'image/png',
      sizeBytes: '0',
      storageUrl: 'https://example.com/x.png',
      storageLocator: 'https://example.com/x.png',
      storageBackend: 'legacy',
      visibility: 'public',
    });
    await em.persistAndFlush(a);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/assets/${a.id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(200);
    const out = (del.json() as { data: { deletedAt: string; purgeAfterAt: string } }).data;
    expect(out.deletedAt).toBeTruthy();
    expect(out.purgeAfterAt).toBeTruthy();

    const restore = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/assets/${a.id}/restore`,
      cookies: adminCookie,
    });
    expect(restore.statusCode).toBe(200);
    const detail = (restore.json() as { data: { id: string; deletedAt: string | null } }).data;
    expect(detail.deletedAt).toBeNull();

    await h.em().removeAndFlush(await h.em().findOneOrFail(Asset, { id: a.id }));
  });

  it('returns 409 ASSET_REFERENCED when an asset is in use by a Product gallery item', async () => {
    // Forge: create asset, create a gallery item via raw SQL pointing at it.
    const em = h.em();
    const a = em.create(Asset, {
      kind: 'image',
      filename: 'in-use.png',
      mimeType: 'image/png',
      sizeBytes: '0',
      storageUrl: 'https://example.com/u.png',
      storageLocator: 'https://example.com/u.png',
      storageBackend: 'legacy',
      visibility: 'public',
    });
    await em.persistAndFlush(a);

    const conn = em.getConnection();
    // Pick any active product to attach to.
    const productRows = (await conn.execute(
      `select id::text as id from products where deleted_at is null limit 1`,
    )) as Array<{ id: string }>;
    if (productRows.length === 0) {
      // No products in this test seed; skip the assertion path.
      await h.em().removeAndFlush(await h.em().findOneOrFail(Asset, { id: a.id }));
      return;
    }
    const productId = productRows[0]!.id;
    await conn.execute(
      `insert into gallery_items (id, product_id, asset_id, position, created_at, updated_at)
       values (gen_random_uuid(), ?, ?, 0, now(), now())`,
      [productId, a.id],
    );

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/assets/${a.id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(409);
    expect(del.json()).toMatchObject({ error: { code: 'ASSET_REFERENCED' } });

    // Cleanup: detach + delete.
    await conn.execute(
      `delete from gallery_items where asset_id = ?`,
      [a.id],
    );
    await h.em().removeAndFlush(await h.em().findOneOrFail(Asset, { id: a.id }));
  });
});
