import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * T196 — `POST /shopping-lists` + add items + convert to Cart.
 * Round-trip: create list → add an item → convert-to-cart → expect
 * the cart's item count to grow.
 */

describe('Shopping list CRUD + convert-to-cart', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates a list, adds an item, converts to cart', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { name: 'Weekly restock' },
    });
    expect(create.statusCode).toBe(201);
    const list = (create.json() as { data: { id: string; name: string } }).data;
    expect(list.name).toBe('Weekly restock');

    const list1 = await h.app.inject({
      method: 'GET',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(list1.statusCode).toBe(200);
    expect((list1.json() as { data: unknown[] }).data.length).toBeGreaterThan(0);

    const addItem = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 3 },
    });
    expect(addItem.statusCode).toBe(201);
    const afterAdd = (addItem.json() as { data: { items: unknown[] } }).data;
    expect(afterAdd.items.length).toBe(1);

    const convert = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/convert-to-cart`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });
    expect(convert.statusCode).toBe(200);
    const result = (
      convert.json() as { data: { added: number; skipped: unknown[] } }
    ).data;
    expect(result.added).toBe(1);
    expect(result.skipped).toEqual([]);
  });

  it('clears all items from a list while keeping the list', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { name: 'To be cleared' },
    });
    const list = (create.json() as { data: { id: string } }).data;

    const addItem = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 2 },
    });
    expect(addItem.statusCode).toBe(201);
    expect((addItem.json() as { data: { items: unknown[] } }).data.items.length).toBe(1);

    const clear = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(clear.statusCode).toBe(204);

    // The list still exists but is now empty.
    const after = await h.app.inject({
      method: 'GET',
      url: `/api/v1/shopping-lists/${list.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(after.statusCode).toBe(200);
    expect((after.json() as { data: { items: unknown[] } }).data.items.length).toBe(0);

    // Clearing an already-empty list is idempotent.
    const clearAgain = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(clearAgain.statusCode).toBe(204);
  });

  it('renames + deletes a list', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { name: 'Temporary' },
    });
    const list = (create.json() as { data: { id: string } }).data;

    const rename = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/shopping-lists/${list.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { name: 'Renamed' },
    });
    expect(rename.statusCode).toBe(200);
    expect((rename.json() as { data: { name: string } }).data.name).toBe('Renamed');

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/shopping-lists/${list.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(del.statusCode).toBe(204);
  });
});
