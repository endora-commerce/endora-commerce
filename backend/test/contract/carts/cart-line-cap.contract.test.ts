import { CartItem } from '../../helpers/package-entities.js';
import { randomUUID } from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';


/**
 * T029 (feature 027 US1) — 200-line cap on `addItem`.
 *
 * Drives the cart up to exactly 200 distinct (productId, variantId)
 * pairs (seeded directly via the EntityManager — bypassing the route to
 * keep the test fast at the scale boundary), then attempts one more
 * POST and asserts HTTP 422 with `error.code = CART_LINE_CAP_EXCEEDED`.
 */

describe('POST /api/v1/cart/items — 200-line cap', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses the 201st distinct line with 422 CART_LINE_CAP_EXCEEDED', async () => {
    const anonToken = `anon-cap-${Date.now()}`;
    // Seed line #1 through the API so the cart record exists.
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(first.statusCode).toBe(200);
    const cartId = (first.json() as { data: { id: string } }).data.id;

    // Fill the cart to 200 lines via direct EM inserts (one product +
    // 199 distinct variantIds + the line seeded above = 200). Bypasses
    // pricing resolution + ownership checks because we already own the
    // cart through the API.
    const em = h.em();
    for (let i = 0; i < 199; i += 1) {
      em.create(CartItem, {
        cartId,
        productId: '00000000-0000-4000-8000-000000000101',
        variantId: randomUUID(),
        quantity: 1,
        unitPrice: '1.00',
        currency: 'PLN',
      });
    }
    await em.flush();

    // 201st attempt — via the route, expect 422.
    const overflow = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', variantId: randomUUID(), quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(overflow.statusCode).toBe(422);
    const body = overflow.json() as { error: { code: string } };
    expect(body.error.code).toBe('CART_LINE_CAP_EXCEEDED');
  });
});
