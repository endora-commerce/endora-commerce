import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T064 happy-path for the ShoppingList → Cart conversion.
 *
 * The earlier smoke suite only asserted the 401 anonymous-caller
 * branch. This test covers the customer path: create a list, add an
 * item, convert. Asserts the response's `appendedLineCount` matches
 * the list's contents, that the cart now contains the line, and that
 * a foreign-owner list returns 404 (anti-enumeration is owned by
 * ShoppingListService.convertToCart).
 */

describe('POST /api/v1/cart/from-shopping-list/:shoppingListId — happy path', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('appends every list line to the buyer cart', async () => {
    // 1) Create a list as the stub customer.
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { name: 'Convert-to-cart fixture' },
    });
    expect(create.statusCode).toBe(201);
    const list = (create.json() as { data: { id: string } }).data;

    // 2) Populate the list with one line.
    const addLine = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${list.id}/items`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 4 },
    });
    expect(addLine.statusCode).toBe(201);

    // 3) Convert.
    const convert = await h.app.inject({
      method: 'POST',
      url: `/api/v1/cart/from-shopping-list/${list.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(convert.statusCode).toBe(200);
    const body = convert.json() as {
      data: {
        appendedLineCount: number;
        droppedLines: Array<{ productId: string; reason: string }>;
      };
    };
    expect(body.data.appendedLineCount).toBe(1);
    expect(body.data.droppedLines).toEqual([]);

    // 4) The cart now contains the appended line.
    const cart = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(cart.statusCode).toBe(200);
    const cartBody = cart.json() as {
      data: { items: Array<{ productId: string; quantity: number }> };
    };
    const appended = cartBody.data.items.find(
      (it) => it.productId === '00000000-0000-4000-8000-000000000101',
    );
    expect(appended).toBeDefined();
    expect(appended?.quantity).toBeGreaterThanOrEqual(4);
  });

  it('returns 404 on a foreign-owner list (anti-enumeration)', async () => {
    const foreignListId = '00000000-0000-4000-8000-00000000aaaa';
    const convert = await h.app.inject({
      method: 'POST',
      url: `/api/v1/cart/from-shopping-list/${foreignListId}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(convert.statusCode).toBe(404);
  });
});
