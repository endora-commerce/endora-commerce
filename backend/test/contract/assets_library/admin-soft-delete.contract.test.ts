import { Asset } from '../../helpers/package-entities.js';
import { overrideAssetSetting } from '../../helpers/crm-attachment-upload.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { removeCrmAssets, seedCrmAdmin, seedCrmAsset } from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

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
    await em.persist(a).flush();

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

    await h.em().remove(await h.em().findOneOrFail(Asset, { id: a.id })).flush();
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
    await em.persist(a).flush();

    const conn = em.getConnection();
    // Pick any active product to attach to.
    const productRows = (await conn.execute(
      `select id::text as id from products where deleted_at is null limit 1`,
    )) as Array<{ id: string }>;
    if (productRows.length === 0) {
      // No products in this test seed; skip the assertion path.
      await h.em().remove(await h.em().findOneOrFail(Asset, { id: a.id })).flush();
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
    // A full-permission reader's answer is today's: one detail per reference,
    // `path` the reference kind and `issue` its label.
    const details = (del.json() as { error: { details: Array<{ path: string; issue: string }> } }).error.details;
    expect(details).toHaveLength(1);
    expect(details[0]).toEqual({ path: 'product_gallery', issue: expect.any(String) });

    // Cleanup: detach + delete.
    await conn.execute(
      `delete from gallery_items where asset_id = ?`,
      [a.id],
    );
    await h.em().remove(await h.em().findOneOrFail(Asset, { id: a.id })).flush();
  });

  // specs/156-asset-stable-url/ T042 — the reported purge date follows the
  // setting as read now (FR-029, owner ruling P1), so it agrees with the sweep.
  it('reports deletedAt + the current retention, also when the delete is repeated after the setting changed', async () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const em = h.em();
    const a = em.create(Asset, {
      kind: 'image',
      filename: 'as156-retention-report.png',
      mimeType: 'image/png',
      sizeBytes: '0',
      storageUrl: 'https://example.com/as156.png',
      storageLocator: 'https://example.com/as156.png',
      storageBackend: 'legacy',
      visibility: 'public',
    });
    await em.persist(a).flush();
    const restoreSeven = await overrideAssetSetting(h, 'assets.soft_delete_retention_days', 7);
    try {
      const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${a.id}`, cookies: adminCookie });
      expect(del.statusCode).toBe(200);
      const first = (del.json() as { data: { deletedAt: string; purgeAfterAt: string } }).data;
      expect(Date.parse(first.purgeAfterAt) - Date.parse(first.deletedAt)).toBe(7 * DAY_MS);

      const restoreThree = await overrideAssetSetting(h, 'assets.soft_delete_retention_days', 3);
      try {
        const again = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${a.id}`, cookies: adminCookie });
        expect(again.statusCode).toBe(200);
        const second = (again.json() as { data: { deletedAt: string; purgeAfterAt: string } }).data;
        expect(second.deletedAt).toBe(first.deletedAt);
        expect(Date.parse(second.purgeAfterAt) - Date.parse(second.deletedAt)).toBe(3 * DAY_MS);
      } finally {
        await restoreThree();
      }
    } finally {
      await restoreSeven();
      await h.em().remove(await h.em().findOneOrFail(Asset, { id: a.id })).flush();
    }
  });

  // specs/166-asset-reference-visibility/ T041 (R-8, invariant I-1): the
  // refusal still counts every reference, but its count and `details` are
  // the references the caller may see — at least one, never a hidden record.
  it('names only the references a restricted reader may see in the 409, and at least one', async () => {
    const reader = await seedCrmAdmin(h.em(), 'sd166', ['assets.read', 'assets.write', 'tasks:read']);
    const conn = h.em().getConnection();
    const { id } = await seedCrmAsset(h.em(), { filename: `sd166-${randomUUID().slice(0, 8)}.pdf` });
    const task = randomUUID();
    const products = (await conn.execute(
      `select id::text as id from products where deleted_at is null limit 1`,
    )) as Array<{ id: string }>;
    expect(products.length, 'the us1-catalog seed must hold a product').toBeGreaterThan(0);
    try {
      await conn.execute(
        `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "is_private") values (?, ?, 'sd166', ?, true)`,
        [task, `T-SD-${task.slice(0, 8)}`, TEST_ADMIN_ID],
      );
      await conn.execute(
        `insert into "task_attachments" ("task_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`,
        [task, id, TEST_ADMIN_ID],
      );
      await conn.execute(
        `insert into gallery_items (id, product_id, asset_id, position, created_at, updated_at)
         values (gen_random_uuid(), ?, ?, 0, now(), now())`,
        [products[0]!.id, id],
      );
      const refusal = async (cookies: Record<string, string>) => {
        const response = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${id}`, cookies });
        expect(response.statusCode, response.body).toBe(409);
        const body = response.json() as { error: { code: string; details: Array<{ path: string; issue: string }> } };
        expect(body.error.code).toBe('ASSET_REFERENCED');
        return body.error.details;
      };
      const full = await refusal(adminCookie);
      expect(full.map((d) => d.path).sort()).toEqual(['product_gallery', 'task_attachment']);
      const restricted = await refusal(reader.cookies);
      expect(restricted.length).toBeGreaterThanOrEqual(1);
      expect(restricted).toEqual(full.filter((d) => d.path === 'product_gallery'));
    } finally {
      await conn.execute(`delete from gallery_items where asset_id = ?`, [id]);
      await conn.execute(`delete from "tasks" where "id" = ?`, [task]);
      await removeCrmAssets(h.em(), [id]);
      reader.undo();
    }
  });
});
