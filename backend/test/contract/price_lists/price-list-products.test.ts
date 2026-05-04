import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID } from '../../helpers/seed-catalog.js';

/**
 * Feature 011 / US3 — Engine product/bracket routes (T043).
 *
 * Covers `/api/v1/admin/price-lists-engine/:id/products[...]/brackets[...]`
 * per `contracts/price-list-products.contract.md`.
 */
const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('Admin price-list-products + brackets routes (feature 011 US3)', () => {
  let h: BackendServerHandle;
  let listId: string;

  beforeAll(async () => {
    h = await setupBackendServer();

    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/price-lists-engine',
      cookies: ADMIN_COOKIE,
      payload: { name: 'US3 Test', type: 'sale' },
    });
    listId = (create.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('POST /products appends a product to the list', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/price-lists-engine/${listId}/products`,
      cookies: ADMIN_COOKIE,
      payload: { productId: SEED_PRODUCT_101_ID },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { priceListId: string; productId: string } };
    expect(body.data).toEqual({ priceListId: listId, productId: SEED_PRODUCT_101_ID });
  });

  it('GET /products lists assignments with empty bracket maps initially', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/price-lists-engine/${listId}/products`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { items: Array<{ productId: string; bracketsByCurrency: Record<string, unknown> }> };
    };
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.productId).toBe(SEED_PRODUCT_101_ID);
    expect(body.data.items[0]?.bracketsByCurrency).toEqual({});
  });

  it('PUT /brackets persists a multi-bracket multi-currency series', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/price-lists-engine/${listId}/products/${SEED_PRODUCT_101_ID}/brackets`,
      cookies: ADMIN_COOKIE,
      payload: {
        bracketsByCurrency: {
          PLN: [
            { minQuantity: 1, maxQuantity: 9, amount: '100.0000' },
            { minQuantity: 10, maxQuantity: null, amount: '90.0000' },
          ],
          EUR: [{ minQuantity: 1, maxQuantity: null, amount: '24.0000' }],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { bracketsByCurrency: Record<string, Array<{ minQuantity: number; amount: string }>> };
    };
    expect(body.data.bracketsByCurrency['PLN']).toHaveLength(2);
    expect(body.data.bracketsByCurrency['EUR']).toHaveLength(1);
  });

  it('PUT /brackets refuses overlapping brackets', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/price-lists-engine/${listId}/products/${SEED_PRODUCT_101_ID}/brackets`,
      cookies: ADMIN_COOKIE,
      payload: {
        bracketsByCurrency: {
          PLN: [
            { minQuantity: 1, maxQuantity: 10, amount: '100' },
            { minQuantity: 5, maxQuantity: 20, amount: '90' },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /brackets returns the persisted brackets', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/price-lists-engine/${listId}/products/${SEED_PRODUCT_101_ID}/brackets`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { bracketsByCurrency: Record<string, unknown[]> };
    };
    expect(body.data.bracketsByCurrency['PLN']).toHaveLength(2);
  });

  it('POST /brackets/copy duplicates one currency series into another', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/price-lists-engine/${listId}/products/${SEED_PRODUCT_101_ID}/brackets/copy`,
      cookies: ADMIN_COOKIE,
      payload: { fromCurrency: 'PLN', toCurrencies: ['CZK'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { added: number } };
    expect(body.data.added).toBe(2);
  });

  it('PUT /products performs delta replacement', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/price-lists-engine/${listId}/products`,
      cookies: ADMIN_COOKIE,
      payload: { productIds: [SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { added: number; removed: number; unchanged: number };
    };
    expect(body.data.added).toBe(2); // 102 + 103
    expect(body.data.removed).toBe(1); // 101 (carrying its brackets)
    expect(body.data.unchanged).toBe(0);
  });

  it('DELETE /products/:productId removes the assignment + cascades brackets', async () => {
    // Add brackets first so we can verify the cascade.
    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/price-lists-engine/${listId}/products/${SEED_PRODUCT_102_ID}/brackets`,
      cookies: ADMIN_COOKIE,
      payload: {
        bracketsByCurrency: { PLN: [{ minQuantity: 1, maxQuantity: null, amount: '50' }] },
      },
    });

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/price-lists-engine/${listId}/products/${SEED_PRODUCT_102_ID}`,
      cookies: ADMIN_COOKIE,
    });
    expect(del.statusCode).toBe(204);

    const after = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/price-lists-engine/${listId}/products/${SEED_PRODUCT_102_ID}/brackets`,
      cookies: ADMIN_COOKIE,
    });
    const afterBody = after.json() as { data: { bracketsByCurrency: Record<string, unknown> } };
    expect(afterBody.data.bracketsByCurrency).toEqual({});
  });

  it('PUT /brackets refuses when the product is not in the list', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/price-lists-engine/${listId}/products/${SEED_PRODUCT_102_ID}/brackets`,
      cookies: ADMIN_COOKIE,
      payload: {
        bracketsByCurrency: { PLN: [{ minQuantity: 1, maxQuantity: null, amount: '50' }] },
      },
    });
    expect(res.statusCode).toBe(404);
  });
});
