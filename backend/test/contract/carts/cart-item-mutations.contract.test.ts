import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T024 + T025 (feature 027 US1) — PATCH / DELETE `/api/v1/cart/items/:itemId`
 * contract.
 *
 * Covers:
 *   - PATCH qty=5 recomputes the line total + cart grand total
 *   - PATCH qty=0 deletes the line and leaves the cart `Active`
 *   - DELETE removes the line and leaves the cart `Active`
 *   - Foundation duplicate-summation preserved on POST (adding the
 *     same product twice sums quantities into a single line)
 *   - PATCH 404 on a foreign cart item (anti-enumeration)
 */

describe('PATCH /api/v1/cart/items/:itemId', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('recomputes line total and grand total when quantity changes', async () => {
    const anonToken = `anon-patch-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add.statusCode).toBe(200);
    const itemId = (add.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemId}`,
      payload: { quantity: 5 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json() as {
      data: {
        items: Array<{
          quantity: number;
          unitPrice: { amount: number };
          lineTotal: { amount: number };
        }>;
        subtotal: { amount: number };
        grandTotal: { amount: number };
      };
    };
    expect(body.data.items[0]?.quantity).toBe(5);
    expect(body.data.items[0]?.lineTotal.amount).toBeCloseTo(
      body.data.items[0]!.unitPrice.amount * 5,
      2,
    );
    expect(body.data.subtotal.amount).toBeCloseTo(body.data.items[0]!.lineTotal.amount, 2);
    expect(body.data.grandTotal.amount).toBeCloseTo(body.data.subtotal.amount, 2);
  });

  it('deletes the line when quantity is 0; cart remains active', async () => {
    const anonToken = `anon-patch-zero-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    const itemId = (add.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemId}`,
      payload: { quantity: 0 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json() as { data: { items: unknown[]; status: string } };
    expect(body.data.items).toEqual([]);
    expect(body.data.status).toBe('active');
  });

  it('returns 404 on a foreign cart item (anti-enumeration)', async () => {
    const tokenA = `anon-patch-foreign-A-${Date.now()}`;
    const addA = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: tokenA },
    });
    const itemIdA = (addA.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;

    // Different anon session (different cart) tries to patch A's line.
    const tokenB = `anon-patch-foreign-B-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: tokenB },
    });
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemIdA}`,
      payload: { quantity: 99 },
      cookies: { b2b_cart_anon: tokenB },
    });
    expect(patch.statusCode).toBe(404);
  });
});

describe('DELETE /api/v1/cart/items/:itemId', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('removes the line and leaves the cart active', async () => {
    const anonToken = `anon-delete-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 2 },
      cookies: { b2b_cart_anon: anonToken },
    });
    const itemId = (add.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/cart/items/${itemId}`,
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(del.statusCode).toBe(200);
    const body = del.json() as {
      data: { items: unknown[]; status: string; subtotal: { amount: number } };
    };
    expect(body.data.items).toEqual([]);
    expect(body.data.status).toBe('active');
    expect(body.data.subtotal.amount).toBe(0);
  });

  it('returns 404 on a foreign cart item', async () => {
    const tokenA = `anon-delete-foreign-A-${Date.now()}`;
    const addA = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: tokenA },
    });
    const itemIdA = (addA.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;

    const tokenB = `anon-delete-foreign-B-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: tokenB },
    });
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/cart/items/${itemIdA}`,
      cookies: { b2b_cart_anon: tokenB },
    });
    expect(del.statusCode).toBe(404);
  });
});

describe('POST /api/v1/cart/items — foundation duplicate-summation', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('sums quantities into a single line when the same product is added twice', async () => {
    const anonToken = `anon-dup-${Date.now()}`;
    const add1 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 2 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add1.statusCode).toBe(200);

    const add2 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 3 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add2.statusCode).toBe(200);

    const get = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    const body = get.json() as { data: { items: Array<{ quantity: number }>; itemCount: number } };
    expect(body.data.itemCount).toBe(1);
    expect(body.data.items[0]?.quantity).toBe(5);
  });
});
