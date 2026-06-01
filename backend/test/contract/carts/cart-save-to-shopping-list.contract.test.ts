import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T026 (feature 027 US1) — `POST /api/v1/cart/items/:itemId/save-to-shopping-list`.
 *
 * Covers:
 *   - line is appended to the named list with the cart line's quantity
 *   - the cart is unchanged after the save
 *   - foreign-list returns 404 (anti-enumeration; ShoppingListService
 *     refuses lists not owned by the caller)
 *   - anonymous caller returns 401 (sign-in required)
 */

describe('POST /api/v1/cart/items/:itemId/save-to-shopping-list', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('appends the line to the named shopping list; cart is unchanged', async () => {
    // 1) Create a shopping list as the stub customer.
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { name: 'Save-from-cart fixture' },
    });
    expect(create.statusCode).toBe(201);
    const list = (create.json() as { data: { id: string } }).data;

    // 2) Add a line to the cart as the same customer.
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 3 },
    });
    expect(add.statusCode).toBe(200);
    const cartBefore = add.json() as { data: { id: string; items: { id: string; quantity: number }[] } };
    const itemId = cartBefore.data.items[0]!.id;

    // 3) Save the line to the list.
    const save = await h.app.inject({
      method: 'POST',
      url: `/api/v1/cart/items/${itemId}/save-to-shopping-list`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { shoppingListId: list.id },
    });
    expect(save.statusCode).toBe(204);

    // 4) Cart is unchanged.
    const cartAfter = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const cartAfterBody = cartAfter.json() as { data: { items: { id: string; quantity: number }[] } };
    expect(cartAfterBody.data.items).toHaveLength(cartBefore.data.items.length);
    expect(cartAfterBody.data.items[0]?.quantity).toBe(3);

    // 5) List contains the new item.
    const listDetail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/shopping-lists/${list.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(listDetail.statusCode).toBe(200);
    const listBody = listDetail.json() as {
      data: { items: Array<{ productId: string; quantity: number }> };
    };
    const saved = listBody.data.items.find(
      (it) => it.productId === '00000000-0000-4000-8000-000000000101',
    );
    expect(saved).toBeDefined();
    expect(saved?.quantity).toBe(3);
  });

  it('returns 404 on a list not owned by the caller (anti-enumeration)', async () => {
    // Pretend a list id of a completely different shape exists somewhere else.
    const foreignListId = '00000000-0000-4000-8000-00000000aaaa';

    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
    });
    expect(add.statusCode).toBe(200);
    const itemId = (add.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;

    const save = await h.app.inject({
      method: 'POST',
      url: `/api/v1/cart/items/${itemId}/save-to-shopping-list`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { shoppingListId: foreignListId },
    });
    expect(save.statusCode).toBe(404);
  });

  it('returns 401 when called by an anonymous session', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/cart/items/00000000-0000-4000-8000-aaaaaaaaaaaa/save-to-shopping-list`,
      payload: { shoppingListId: '00000000-0000-4000-8000-bbbbbbbbbbbb' },
    });
    expect(res.statusCode).toBe(401);
  });
});
