import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T132 — `productDetail` MUST carry the type-discriminated composite
 * payloads:
 *   - `groupedItems[]` only when type='grouped'
 *   - `bundleSlots[]` only when type='bundle' (with options nested)
 *   - `virtual{downloadAssetId, downloadUrl}` only when type='virtual'
 *
 * Per Constitution Principle III: written FIRST, fails because the query
 * service still returns the foundation-era productDetail without the
 * composite branches.
 */

describe('productDetail composite eager-load (T132)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(
    suffix: string,
    type: 'simple' | 'grouped' | 'bundle' | 'virtual' = 'simple',
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; slug: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `CD-${type.toUpperCase()}-${suffix}`,
        type,
        name: { 'en-US': `CD ${type} ${suffix}` },
        description: { 'en-US': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        ...extra,
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const data = (res.json() as { data: { id: string; slug: string } }).data;
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
    await conn.execute(`update products set status = 'active' where id = ?`, [data.id]);
    return data;
  }

  it('grouped: productDetail.groupedItems lists children with quantity + product summary', async () => {
    const parent = await createProduct('GROUPED', 'grouped');
    const childA = await createProduct('CHILD-A');
    const childB = await createProduct('CHILD-B');

    for (const [child, qty] of [
      [childA.id, 2],
      [childB.id, 5],
    ] as const) {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/catalog/products/${parent.id}/grouped-items`,
        payload: { childProductId: child, quantity: qty },
        cookies: adminCookie,
      });
      expect(res.statusCode).toBe(201);
    }

    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${parent.slug}`,
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      data: {
        type: string;
        groupedItems?: Array<{
          quantity: number;
          product: { id: string; sku: string; name: string };
        }>;
        bundleSlots?: unknown;
        virtual?: unknown;
      };
    };
    expect(body.data.type).toBe('grouped');
    expect(body.data.groupedItems?.length).toBe(2);
    const sortedQuantities = body.data.groupedItems!.map((g) => g.quantity).sort();
    expect(sortedQuantities).toEqual([2, 5]);
    expect(body.data.bundleSlots).toBeUndefined();
    expect(body.data.virtual).toBeUndefined();
  });

  it('bundle: productDetail.bundleSlots includes options nested with product summary', async () => {
    const parent = await createProduct('BUNDLE', 'bundle');
    const optionProduct = await createProduct('BUNDLE-OPT');

    const slot = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent.id}/bundle-slots`,
      payload: { name: { 'en-US': 'Color' }, minQuantity: 1, maxQuantity: 1 },
      cookies: adminCookie,
    });
    expect(slot.statusCode).toBe(201);
    const slotId = (slot.json() as { data: { id: string } }).data.id;

    const opt = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent.id}/bundle-slots/${slotId}/options`,
      payload: { optionProductId: optionProduct.id },
      cookies: adminCookie,
    });
    expect(opt.statusCode).toBe(201);

    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${parent.slug}`,
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      data: {
        type: string;
        bundleSlots?: Array<{
          minQuantity: number;
          maxQuantity: number;
          options: Array<{ product: { id: string } }>;
        }>;
        groupedItems?: unknown;
        virtual?: unknown;
      };
    };
    expect(body.data.type).toBe('bundle');
    expect(body.data.bundleSlots?.length).toBe(1);
    expect(body.data.bundleSlots![0]?.options.length).toBe(1);
    expect(body.data.bundleSlots![0]?.options[0]?.product.id).toBe(optionProduct.id);
    expect(body.data.groupedItems).toBeUndefined();
    expect(body.data.virtual).toBeUndefined();
  });

  it('virtual: productDetail.virtual carries downloadUrl when set', async () => {
    const product = await createProduct('VIRTUAL', 'virtual', {
      downloadUrl: 'https://example.test/virtual-file.pdf',
    });
    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${product.slug}`,
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      data: {
        type: string;
        virtual?: { downloadAssetId: string | null; downloadUrl: string | null };
        groupedItems?: unknown;
        bundleSlots?: unknown;
      };
    };
    expect(body.data.type).toBe('virtual');
    expect(body.data.virtual?.downloadUrl).toBe('https://example.test/virtual-file.pdf');
    expect(body.data.virtual?.downloadAssetId).toBeNull();
    expect(body.data.groupedItems).toBeUndefined();
    expect(body.data.bundleSlots).toBeUndefined();
  });

  it('simple: no composite payloads present', async () => {
    const product = await createProduct('SIMPLE', 'simple');
    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${product.slug}`,
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      data: { groupedItems?: unknown; bundleSlots?: unknown; virtual?: unknown };
    };
    expect(body.data.groupedItems).toBeUndefined();
    expect(body.data.bundleSlots).toBeUndefined();
    expect(body.data.virtual).toBeUndefined();
  });
});
