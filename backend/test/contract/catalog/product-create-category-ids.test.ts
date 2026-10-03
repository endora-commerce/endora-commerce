import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `categoryIds` is a required field of the create-product request, so every
 * route that creates a product from that request must persist it. Both create
 * routes used to answer 201 and write no `product_categories` row: the admin
 * editor's category picks on a new product vanished, and an integration's
 * first `PUT … by-sku` left the product in no category until a second call
 * took the update path.
 */
describe('product create routes persist categoryIds', () => {
  let h: BackendServerHandle;
  let writeToken: string;
  let categoryA: string;
  let categoryB: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createCategory(slug: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/categories',
      payload: { name: { 'en-US': slug }, slug },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function bridgeRows(productId: string): Promise<string[]> {
    const rows = (await h
      .em()
      .getConnection()
      .execute('select category_id from product_categories where product_id = ?', [
        productId,
      ])) as Array<{ category_id: string }>;
    return rows.map((r) => r.category_id).sort();
  }

  function payload(sku: string, categoryIds: string[]) {
    return {
      sku,
      type: 'simple' as const,
      name: { 'en-US': `Product ${sku}` },
      description: { 'en-US': 'desc' },
      categoryIds,
      attributeValues: {},
      visibility: 'public' as const,
    };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    categoryA = await createCategory('create-category-ids-a');
    categoryB = await createCategory('create-category-ids-b');
    const key = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload: { name: 'Category create writer', scopes: ['catalog:write'] },
      cookies: adminCookie,
    });
    writeToken = (key.json() as { data: { bearerToken: string } }).data.bearerToken;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('POST /admin/catalog/products writes the bridge rows and the editor reads them back', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: payload('CAT-CREATE-ADMIN-1', [categoryA, categoryB]),
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;

    expect(await bridgeRows(id)).toEqual([categoryA, categoryB].sort());

    // What the admin editor loads after its post-create redirect.
    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: adminCookie,
    });
    expect(get.statusCode).toBe(200);
    const read = (get.json() as { data: { categoryIds: string[] } }).data.categoryIds;
    expect([...read].sort()).toEqual([categoryA, categoryB].sort());
  });

  it('POST /admin/catalog/products with no categories writes no bridge row', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: payload('CAT-CREATE-ADMIN-2', []),
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    expect(await bridgeRows(id)).toEqual([]);
  });

  it('PUT /catalog/products/by-sku writes the bridge rows on the creating call', async () => {
    const first = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/catalog/products/by-sku/CAT-CREATE-KEY-1',
      payload: payload('CAT-CREATE-KEY-1', [categoryA]),
      headers: { authorization: `Bearer ${writeToken}` },
    });
    expect(first.statusCode).toBe(201);
    const id = (first.json() as { data: { id: string } }).data.id;
    expect(await bridgeRows(id)).toEqual([categoryA]);

    // The repeat call takes the update path; the set is replaced, not unioned.
    const second = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/catalog/products/by-sku/CAT-CREATE-KEY-1',
      payload: payload('CAT-CREATE-KEY-1', [categoryB]),
      headers: { authorization: `Bearer ${writeToken}` },
    });
    expect(second.statusCode).toBe(200);
    expect(await bridgeRows(id)).toEqual([categoryB]);
  });
});
