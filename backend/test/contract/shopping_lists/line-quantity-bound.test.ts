import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import { LINE_QUANTITY_MAX, expectQuantityRefused } from '../../helpers/line-bounds.js';

/**
 * Issue #351 — a shopping-list item's quantity is bounded at
 * `LINE_QUANTITY_MAX` on add and on update: one past it is
 * `400 VALIDATION_FAILED` naming `quantity`, the bound itself is stored.
 */
describe('shopping lists — line quantity bound (issue #351)', () => {
  let h: BackendServerHandle;
  const CUSTOMER = { b2b_session: 'stub-customer-session' };
  let listId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: CUSTOMER,
      payload: { name: `Line bound ${Date.now()}` },
    });
    expect(res.statusCode, res.body).toBe(201);
    listId = (res.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const add = (quantity: number, productId = SEED_PRODUCT_101_ID) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${listId}/items`,
      cookies: CUSTOMER,
      payload: { productId, quantity },
    });

  it('POST /api/v1/shopping-lists/:id/items refuses one past the bound and stores the bound', async () => {
    expectQuantityRefused(await add(LINE_QUANTITY_MAX + 1), 'quantity');
    expectQuantityRefused(await add(2 ** 31), 'quantity');
    const res = await add(LINE_QUANTITY_MAX);
    expect(res.statusCode, res.body.slice(0, 500)).toBe(201);
  });

  it('PATCH /api/v1/shopping-lists/:id/items/:itemId refuses one past the bound and stores the bound', async () => {
    // Another product, so the item is not the one the add test stored at the bound.
    const added = await add(1, SEED_PRODUCT_102_ID);
    expect(added.statusCode, added.body.slice(0, 500)).toBe(201);
    const items = (added.json() as { data: { items: Array<{ id: string; productId: string }> } }).data.items;
    const itemId = items.find((i) => i.productId === SEED_PRODUCT_102_ID)!.id;
    const patch = (quantity: number) =>
      h.app.inject({
        method: 'PATCH',
        url: `/api/v1/shopping-lists/${listId}/items/${itemId}`,
        cookies: CUSTOMER,
        payload: { quantity },
      });
    expectQuantityRefused(await patch(LINE_QUANTITY_MAX + 1), 'quantity');
    const res = await patch(LINE_QUANTITY_MAX);
    expect(res.statusCode, res.body.slice(0, 500)).toBe(200);
  });
});
