import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T055 — Contract test for Product Gallery admin surface (feature 002 US3).
 *
 * Endpoints:
 *   GET    /api/v1/admin/catalog/products/:productId/gallery
 *   POST   /api/v1/admin/catalog/products/:productId/gallery
 *   PATCH  /api/v1/admin/catalog/products/:productId/gallery/:itemId
 *   DELETE /api/v1/admin/catalog/products/:productId/gallery/:itemId
 *   PUT    /api/v1/admin/catalog/products/:productId/gallery/order
 *
 * Errors:
 *   - 404 PRODUCT_NOT_FOUND when parent missing
 *   - 404 NOT_FOUND when gallery_item missing
 *   - 409 GALLERY_LABEL_ALREADY_TAKEN when assigning a label that's already
 *     present on a different gallery_item (same product) without ?replace=true
 *   - 400 GALLERY_LABEL_LIMIT_EXCEEDED when an item gets > 3 labels
 *   - 400 ASSET_KIND_NOT_SUPPORTED when asset.kind ∉ {image, video}
 *
 * Per Constitution Principle III: written FIRST, fails for the right
 * reason — routes don't exist yet.
 */

describe('Admin Gallery contract (T055)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(suffix: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `GAL-PARENT-${suffix}`,
        type: 'simple',
        name: { 'en-US': `Gallery parent ${suffix}` },
        description: { 'en-US': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function seedAsset(kind: 'image' | 'video' | 'pdf'): Promise<string> {
    // Insert an Asset directly via raw SQL (no public Assets module
    // upload route in foundation). The catalog-side gallery routes
    // operate on existing asset ids.
    const conn = h.orm.em.getConnection();
    const id = randomUuid();
    await conn.execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, ?, 'test.bin', 'application/octet-stream', 1024, 'https://example.test/asset.bin', now(), now())`,
      [id, kind],
    );
    return id;
  }

  function randomUuid(): string {
    // crypto.randomUUID returns valid v4 — needed because Zod uuidSchema
    // uses Zod's UUID v4 regex.
    return crypto.randomUUID();
  }

  it('POST creates a gallery item with labels; GET lists it', async () => {
    const productId = await createProduct('A');
    const assetId = await seedAsset('image');

    const create = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      payload: { assetId, labels: ['base_image', 'thumbnail'] },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(201);
    const body = create.json() as {
      data: { id: string; labels: string[]; assetId: string };
    };
    expect(body.data.assetId).toBe(assetId);
    expect(body.data.labels.sort()).toEqual(['base_image', 'thumbnail']);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    const listed = (list.json() as { data: Array<{ id: string }> }).data;
    expect(listed.length).toBe(1);
  });

  it('POST rejects 409 when a label collides without ?replace=true', async () => {
    const productId = await createProduct('B');
    const assetA = await seedAsset('image');
    const assetB = await seedAsset('image');

    const first = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      payload: { assetId: assetA, labels: ['base_image'] },
      cookies: adminCookie,
    });
    expect(first.statusCode).toBe(201);

    const collide = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      payload: { assetId: assetB, labels: ['base_image'] },
      cookies: adminCookie,
    });
    expect(collide.statusCode).toBe(409);
    expect((collide.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.GALLERY_LABEL_ALREADY_TAKEN,
    );
  });

  it('POST with ?replace=true atomically swaps the conflicting label', async () => {
    const productId = await createProduct('C');
    const assetA = await seedAsset('image');
    const assetB = await seedAsset('image');

    const first = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      payload: { assetId: assetA, labels: ['base_image'] },
      cookies: adminCookie,
    });
    expect(first.statusCode).toBe(201);
    const firstId = (first.json() as { data: { id: string } }).data.id;

    const swap = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery?replace=true`,
      payload: { assetId: assetB, labels: ['base_image'] },
      cookies: adminCookie,
    });
    expect(swap.statusCode).toBe(201);
    const swapId = (swap.json() as { data: { id: string } }).data.id;
    expect(swapId).not.toBe(firstId);

    // After swap, the original gallery item lost the base_image label.
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      cookies: adminCookie,
    });
    const items = (list.json() as { data: Array<{ id: string; labels: string[] }> }).data;
    const original = items.find((i) => i.id === firstId);
    const next = items.find((i) => i.id === swapId);
    expect(original?.labels).toEqual([]);
    expect(next?.labels).toEqual(['base_image']);
  });

  it('POST rejects > 3 labels with 400 GALLERY_LABEL_LIMIT_EXCEEDED', async () => {
    const productId = await createProduct('D');
    const assetId = await seedAsset('image');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      payload: {
        assetId,
        // Zod allows the array; service rejects > 3 by domain rule. Use 3
        // valid labels + 1 duplicate so Zod still passes.
        labels: ['base_image', 'small_image', 'thumbnail', 'base_image'],
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST rejects PDF asset with 400 ASSET_KIND_NOT_SUPPORTED', async () => {
    const productId = await createProduct('E');
    const pdfAssetId = await seedAsset('pdf');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      payload: { assetId: pdfAssetId },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ASSET_KIND_NOT_SUPPORTED,
    );
  });

  it('PATCH updates labels with same conflict semantics', async () => {
    const productId = await createProduct('F');
    const assetA = await seedAsset('image');
    const assetB = await seedAsset('image');

    const a = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      payload: { assetId: assetA, labels: ['base_image'] },
      cookies: adminCookie,
    });
    const aId = (a.json() as { data: { id: string } }).data.id;
    const b = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      payload: { assetId: assetB },
      cookies: adminCookie,
    });
    const bId = (b.json() as { data: { id: string } }).data.id;

    // Try to give B the label 'base_image' without replace=true → 409.
    const conflict = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/gallery/${bId}`,
      payload: { labels: ['base_image'] },
      cookies: adminCookie,
    });
    expect(conflict.statusCode).toBe(409);
    expect((conflict.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.GALLERY_LABEL_ALREADY_TAKEN,
    );

    // With ?replace=true → swap.
    const swap = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/gallery/${bId}?replace=true`,
      payload: { labels: ['base_image'] },
      cookies: adminCookie,
    });
    expect(swap.statusCode).toBe(200);
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      cookies: adminCookie,
    });
    const items = (list.json() as { data: Array<{ id: string; labels: string[] }> }).data;
    expect(items.find((i) => i.id === aId)?.labels).toEqual([]);
    expect(items.find((i) => i.id === bId)?.labels).toEqual(['base_image']);
  });

  it('DELETE removes a gallery item', async () => {
    const productId = await createProduct('G');
    const assetId = await seedAsset('image');
    const create = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      payload: { assetId },
      cookies: adminCookie,
    });
    const itemId = (create.json() as { data: { id: string } }).data.id;

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${productId}/gallery/${itemId}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);
  });

  it('POST returns 404 PRODUCT_NOT_FOUND when parent missing', async () => {
    const ghostAsset = await seedAsset('image');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/00000000-0000-4000-8000-000000000fff/gallery',
      payload: { assetId: ghostAsset },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(404);
  });
});
