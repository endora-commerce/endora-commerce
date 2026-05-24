import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';

/**
 * T063 / T065 happy-path coverage for the three conversion endpoints.
 *
 * The original tasks were deferred citing the need for pre-arranged QR
 * and Shopping-List fixtures. The cart → QR direction can be exercised
 * end-to-end with just a seeded cart (the QR service builds the
 * destination row), so we cover it here. The QR → cart and
 * Shopping-List → cart happy paths rely on a fixture row owned by the
 * caller; those are exercised by the existing 401-only smoke test
 * suite + the integration / supertest follow-ups (T065 / T076).
 */

describe('POST /api/v1/cart/convert-to-quote-request — happy path', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('moves a non-empty cart to completed and emits a quote-request id', async () => {
    // 1) Seed the cart with one line as the stub customer.
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 2 },
    });
    expect(add.statusCode).toBe(200);
    const cartId = (add.json() as { data: { id: string } }).data.id;

    // 2) Convert.
    const convert = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/convert-to-quote-request',
      cookies: { b2b_session: 'stub-customer-session' },
      headers: { 'content-type': 'application/json' },
      payload: { note: 'Please quote — feature 027 happy-path test.' },
    });
    expect(convert.statusCode).toBe(200);
    const body = convert.json() as {
      data: { quoteRequestId: string; cartId: string; quoteRequestSlug: string };
    };
    expect(typeof body.data.quoteRequestId).toBe('string');
    expect(body.data.quoteRequestId.length).toBeGreaterThan(0);
    expect(body.data.cartId).toBe(cartId);

    // 3) Source cart flips to `completed` with
    //    `converted_to_quote_request_id` set. Use a fresh EM fork so
    //    we read the post-conversion state, not the identity-map
    //    snapshot from before the route handler ran.
    const em = h.em().fork({ clear: true });
    const reloaded = await em.findOne(Cart, { id: cartId });
    expect(reloaded?.status).toBe('completed');
    expect(reloaded?.convertedToQuoteRequestId).toBe(body.data.quoteRequestId);

    // 4) Subsequent GET on the same session creates a fresh active cart
    //    (the buyer's "cart slot" is free again).
    const fresh = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(fresh.statusCode).toBe(200);
    const freshBody = fresh.json() as { data: { id: string | null; status: string } };
    expect(freshBody.data.id).not.toBe(cartId);
    expect(freshBody.data.status).toBe('active');
  });

  it('refuses an empty cart with 422 CART_EMPTY', async () => {
    // Use a brand-new customer session id we haven't touched. The
    // route handler calls getOrCreateForCustomer which creates an
    // empty cart for stub-customer if none exists. Since the previous
    // test consumed the customer's cart and we now hold a fresh
    // active one, we need a state where there are *zero* lines.
    const cartBefore = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(cartBefore.statusCode).toBe(200);
    const cartBody = cartBefore.json() as { data: { items: unknown[] } };
    expect(cartBody.data.items).toHaveLength(0);

    const convert = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/convert-to-quote-request',
      cookies: { b2b_session: 'stub-customer-session' },
      headers: { 'content-type': 'application/json' },
      payload: { note: 'Should fail with cart_empty.' },
    });
    expect(convert.statusCode).toBe(422);
    const body = convert.json() as { error: { code: string } };
    expect(body.error.code).toBe('CART_EMPTY');
  });
});
