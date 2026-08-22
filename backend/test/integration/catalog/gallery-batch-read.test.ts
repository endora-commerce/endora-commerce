import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogGalleryPort } from '@endora-commerce/contracts';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 075 / D-87 — the batch gallery read, against the real schema.
 *
 * `test/unit/catalog/gallery-batch-read.test.ts` measures the round-trip cost
 * and the absent-id semantics over a fake `EntityManager`, which cannot see a
 * column that is not there: `gallery_item_labels` carries its own denormalised
 * `product_id`, and both statements lean on it. So the two methods are also
 * exercised over rows this file creates, through the container registration the
 * consumers resolve (`galleryService`) rather than through a hand-built
 * instance.
 */

describe('catalog — the batch gallery read over the real schema', () => {
  let h: BackendServerHandle;
  let gallery: CatalogGalleryPort;

  beforeAll(async () => {
    h = await setupBackendServer();
    gallery = (h.container.cradle as unknown as { galleryService: CatalogGalleryPort })
      .galleryService;
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
        sku: `GAL-BATCH-${suffix}`,
        type: 'simple',
        name: { 'en-US': `Gallery batch ${suffix}` },
        description: { 'en-US': 'desc' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function seedAsset(url: string): Promise<string> {
    const id = randomUUID();
    await h.orm.em.getConnection().execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, 'image', 'test.jpg', 'image/jpeg', 1024, ?, now(), now())`,
      [id, url],
    );
    return id;
  }

  async function attach(productId: string, assetId: string, labels: string[]): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      payload: { assetId, labels },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
  }

  it('returns every product’s items in position order, and none for an id that is gone', async () => {
    const first = await createProduct('ORDER-1');
    const second = await createProduct('ORDER-2');
    const assetA = await seedAsset('https://cdn.test/batch-a.jpg');
    const assetB = await seedAsset('https://cdn.test/batch-b.jpg');
    const assetC = await seedAsset('https://cdn.test/batch-c.jpg');
    await attach(first, assetA, []);
    await attach(first, assetB, []);
    await attach(second, assetC, []);

    const gone = randomUUID();
    const items = await gallery.listForProducts([first, second, gone]);

    expect(items.filter((i) => i.productId === first).map((i) => i.assetId)).toEqual([
      assetA,
      assetB,
    ]);
    expect(items.filter((i) => i.productId === first).map((i) => i.position)).toEqual([0, 1]);
    expect(items.filter((i) => i.productId === second).map((i) => i.assetId)).toEqual([assetC]);
    expect(items.some((i) => i.productId === gone)).toBe(false);
  });

  it('resolves the base image of each product, and null where there is none', async () => {
    const withBase = await createProduct('BASE');
    const withThumbOnly = await createProduct('THUMB-ONLY');
    const withoutGallery = await createProduct('NO-GALLERY');
    const baseAsset = await seedAsset('https://cdn.test/batch-base.jpg');
    const thumbAsset = await seedAsset('https://cdn.test/batch-thumb.jpg');
    await attach(withBase, baseAsset, ['base_image']);
    await attach(withThumbOnly, thumbAsset, ['thumbnail']);

    const gone = randomUUID();
    const urls = await gallery.baseImageUrls([withBase, withThumbOnly, withoutGallery, gone]);

    // One entry per requested id, so a caller may index without re-checking.
    expect([...urls.keys()].sort()).toEqual(
      [withBase, withThumbOnly, withoutGallery, gone].sort(),
    );
    expect(urls.get(withBase)).toBe('https://cdn.test/batch-base.jpg');
    // No fallback to `thumbnail` (spec FR-006 names the base image only).
    expect(urls.get(withThumbOnly)).toBeNull();
    expect(urls.get(withoutGallery)).toBeNull();
    expect(urls.get(gone)).toBeNull();
  });
});
