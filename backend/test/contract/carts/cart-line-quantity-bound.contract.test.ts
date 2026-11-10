import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { LINE_QUANTITY_MAX, expectQuantityRefused } from '../../helpers/line-bounds.js';

/**
 * Issue #351 — `POST /api/v1/cart/items` bounds the line quantity at
 * `LINE_QUANTITY_MAX`: one more is `400 VALIDATION_FAILED` naming `quantity`
 * (it used to reach the integer column and answer 500), the bound itself is
 * added.
 */
describe('POST /api/v1/cart/items — line quantity bound (issue #351)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const add = (anon: string, quantity: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity },
      cookies: { b2b_cart_anon: anon },
    });

  it.each([LINE_QUANTITY_MAX + 1, 2 ** 31])('refuses %d with 400 VALIDATION_FAILED', async (quantity) => {
    expectQuantityRefused(await add(`anon-351-over-${quantity}-${Date.now()}`, quantity), 'quantity');
  });

  it('adds a line at the bound', async () => {
    const res = await add(`anon-351-at-${Date.now()}`, LINE_QUANTITY_MAX);
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { data: { items: Array<{ quantity: number }> } }).data.items;
    expect(items.map((i) => i.quantity)).toEqual([LINE_QUANTITY_MAX]);
  });
});
