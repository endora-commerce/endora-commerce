import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T096 + T097 — gallery-aware asset resolution on the public read paths.
 *
 *   T096: ProductSummary.primaryAssetUrl prefers the gallery's Thumbnail
 *         (then Base Image, then first gallery item) over the legacy
 *         product_assets row, so the catalog listing card shows the
 *         thumbnail an admin curates from the gallery tab.
 *
 *   T097: ProductDetail.seo.openGraph.imageUrl prefers the gallery's
 *         Base Image (then Thumbnail, then primaryAssetUrl), so social
 *         shares get the high-quality hero a marketer uploaded.
 *
 * Per Constitution Principle III: written FIRST, fails for the right
 * reason — current code returns the first product_assets row regardless
 * of gallery state.
 */

describe('Gallery-aware asset resolution (T096 + T097)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(suffix: string): Promise<{ id: string; slug: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `GAL-RES-${suffix}`,
        type: 'simple',
        name: { 'en-US': `Gallery resolution ${suffix}` },
        description: { 'en-US': 'desc' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const data = (res.json() as { data: { id: string; slug: string } }).data;
    // Associate product with the public retail sales channel so the
    // public list/detail endpoints surface it. seed-catalog.ts wires
    // its own products to pl_retail; admin POST does not auto-associate.
    const conn = h.orm.em.getConnection();
    const [retail] = await conn.execute<{ id: string }[]>(
      `select id from sales_channels where code = 'pl_retail'`,
    );
    if (retail) {
      await conn.execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) on conflict do nothing`,
        [retail.id, data.id],
      );
    }
    // Admin POST creates products in 'draft' status; the public listing
    // only surfaces active products. Activate so the listing/detail
    // endpoints behave like a published catalogue would.
    await conn.execute(`update products set status = 'active' where id = ?`, [data.id]);
    return data;
  }

  async function seedAsset(url: string): Promise<string> {
    const conn = h.orm.em.getConnection();
    const id = crypto.randomUUID();
    await conn.execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, 'image', 'test.jpg', 'image/jpeg', 1024, ?, now(), now())`,
      [id, url],
    );
    return id;
  }

  async function attachGalleryItem(
    productId: string,
    assetId: string,
    labels: string[],
  ): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      payload: { assetId, labels },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
  }

  it('listing summary uses gallery Thumbnail as primaryAssetUrl when present', async () => {
    const product = await createProduct('THUMB');
    const thumbAsset = await seedAsset('https://cdn.test/thumb.jpg');
    const baseAsset = await seedAsset('https://cdn.test/base.jpg');
    await attachGalleryItem(product.id, baseAsset, ['base_image']);
    await attachGalleryItem(product.id, thumbAsset, ['thumbnail']);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=GAL-RES-THUMB`,
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      data: Array<{ slug: string; primaryAssetUrl: string | null }>;
    };
    const found = body.data.find((p) => p.slug === product.slug);
    expect(found?.primaryAssetUrl).toBe('https://cdn.test/thumb.jpg');
  });

  it('listing falls back to Base Image when no Thumbnail is set', async () => {
    const product = await createProduct('BASE-ONLY');
    const baseAsset = await seedAsset('https://cdn.test/only-base.jpg');
    await attachGalleryItem(product.id, baseAsset, ['base_image']);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=GAL-RES-BASE-ONLY`,
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      data: Array<{ slug: string; primaryAssetUrl: string | null }>;
    };
    const found = body.data.find((p) => p.slug === product.slug);
    expect(found?.primaryAssetUrl).toBe('https://cdn.test/only-base.jpg');
  });

  it('PDP openGraph.imageUrl uses gallery Base Image when present', async () => {
    const product = await createProduct('OG');
    const thumbAsset = await seedAsset('https://cdn.test/og-thumb.jpg');
    const baseAsset = await seedAsset('https://cdn.test/og-base.jpg');
    await attachGalleryItem(product.id, thumbAsset, ['thumbnail']);
    await attachGalleryItem(product.id, baseAsset, ['base_image']);

    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${product.slug}`,
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      data: { seo: { openGraph: { imageUrl: string | null } } };
    };
    expect(body.data.seo.openGraph.imageUrl).toBe('https://cdn.test/og-base.jpg');
  });

  it('PDP openGraph.imageUrl falls back to Thumbnail when no Base Image set', async () => {
    const product = await createProduct('OG-FALLBACK');
    const thumbAsset = await seedAsset('https://cdn.test/og-fb-thumb.jpg');
    await attachGalleryItem(product.id, thumbAsset, ['thumbnail']);

    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${product.slug}`,
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      data: { seo: { openGraph: { imageUrl: string | null } } };
    };
    expect(body.data.seo.openGraph.imageUrl).toBe('https://cdn.test/og-fb-thumb.jpg');
  });
});
