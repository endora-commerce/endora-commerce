import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 / T011 — untouched-field invariant for
 * `POST /products/bulk-update`.
 *
 * The single-product PATCH equivalent
 * (`catalog-admin-update-product-status.test.ts > PATCH without status …`)
 * already proves this for status; this test confirms the bulk endpoint
 * inherits the semantics for visibility, sales-channel membership,
 * category membership, and attribute values.
 *
 * Method: seed a product with each field set to a known non-default
 * value, then call bulk-update with ONLY `status: 'active'`, and assert
 * every other field is untouched.
 */
describe('Feature 022 — POST /products/bulk-update (untouched-field invariant)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(
    sku: string,
    visibility: 'public' | 'logged_in_only' = 'logged_in_only',
  ): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku,
        type: 'simple',
        name: { 'en-US': sku },
        description: { 'en-US': 'desc' },
        categoryIds: [],
        attributeValues: {},
        visibility,
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function getChannelIdByCode(code: string): Promise<string> {
    const rows = (await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(`select id from sales_channels where code = ?`, [code])) as Array<{
      id: string;
    }>;
    expect(rows[0]).toBeDefined();
    return rows[0]!.id;
  }

  async function getCategoryIdBySlug(slug: string): Promise<string> {
    const rows = (await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(`select id from categories where slug = ?`, [slug])) as Array<{
      id: string;
    }>;
    expect(rows[0]).toBeDefined();
    return rows[0]!.id;
  }

  async function readChannelIdsForProduct(productId: string): Promise<string[]> {
    const rows = (await h
      .em()
      .getConnection()
      .execute<Array<{ sales_channel_id: string }>>(
        `select sales_channel_id from sales_channel_products where product_id = ? order by sales_channel_id`,
        [productId],
      )) as Array<{ sales_channel_id: string }>;
    return rows.map((r) => r.sales_channel_id);
  }

  async function readCategoryIdsForProduct(productId: string): Promise<string[]> {
    const rows = (await h
      .em()
      .getConnection()
      .execute<Array<{ category_id: string }>>(
        `select category_id from product_categories where product_id = ? order by category_id`,
        [productId],
      )) as Array<{ category_id: string }>;
    return rows.map((r) => r.category_id);
  }

  async function getProduct(id: string): Promise<{
    status: string;
    visibility: string;
    attributeValues: Record<string, unknown>;
  }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as {
      data: { status: string; visibility: string; attributeValues: Record<string, unknown> };
    }).data;
  }

  it('bulk-update { status } leaves visibility / channels / categories / attribute values untouched', async () => {
    // 1. Create product with visibility=logged_in_only.
    const id = await createProduct('BULK-UNTOUCHED-001', 'logged_in_only');
    const retail = await getChannelIdByCode('pl_retail');
    const b2bVip = await getChannelIdByCode('pl_b2b_vip');
    const small = await getCategoryIdBySlug('small-widgets');
    const large = await getCategoryIdBySlug('large-widgets');

    // 2. Seed channels (replace drops the auto-bound default).
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { salesChannels: { mode: 'replace', channelIds: [retail, b2bVip] } },
      },
      cookies: adminCookie,
    });
    // 3. Seed categories.
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { categories: { mode: 'replace', categoryIds: [small, large] } },
      },
      cookies: adminCookie,
    });
    // 4. Seed an attribute value via PATCH (the single-product editor
    //    is the canonical path for non-mass-editable attribute writes;
    //    bulk-update would refuse without massEditable=true).
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { attributeValues: { color: 'red' } },
      cookies: adminCookie,
    });
    expect(patch.statusCode).toBe(200);

    // Snapshot the known state.
    const before = await getProduct(id);
    expect(before.status).toBe('draft');
    expect(before.visibility).toBe('logged_in_only');
    expect(before.attributeValues).toMatchObject({ color: 'red' });
    expect((await readChannelIdsForProduct(id)).sort()).toEqual([retail, b2bVip].sort());
    expect((await readCategoryIdsForProduct(id)).sort()).toEqual([small, large].sort());

    // 5. Call bulk-update with ONLY `status: 'active'`. Every other
    //    field should be left in place.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { status: 'active' },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);

    // 6. Assert untouched-field invariant.
    const after = await getProduct(id);
    expect(after.status).toBe('active');
    expect(after.visibility).toBe('logged_in_only');
    expect(after.attributeValues).toMatchObject({ color: 'red' });
    expect((await readChannelIdsForProduct(id)).sort()).toEqual([retail, b2bVip].sort());
    expect((await readCategoryIdsForProduct(id)).sort()).toEqual([small, large].sort());
  });

  it('bulk-update with empty salesChannels not present in fields does not drop existing memberships', async () => {
    // Targeted regression for the case where the dialog omits the
    // salesChannels group entirely — the bulk service must not interpret
    // `undefined` as "remove every channel".
    const id = await createProduct('BULK-UNTOUCHED-CHAN-001', 'public');
    const retail = await getChannelIdByCode('pl_retail');

    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { salesChannels: { mode: 'replace', channelIds: [retail] } },
      },
      cookies: adminCookie,
    });
    expect(await readChannelIdsForProduct(id)).toEqual([retail]);

    // PATCH only visibility — channels must remain.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { visibility: 'logged_in_only' },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    expect(await readChannelIdsForProduct(id)).toEqual([retail]);
  });
});
