import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T105 — R-09 cart merge: an anonymous visitor's Cart (identified by a
 * `b2b_cart_anon` cookie) merges into the authenticated Cart on sign-in.
 * Items already in the authenticated Cart are preserved; duplicates are
 * combined by summing quantities.
 */

interface Cart { id: string; items: { productId: string; quantity: number }[] }

describe('cart merges from anonymous into authenticated on login', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('items from anonymous cart show up after login', async () => {
    const anonToken = 'anon-test-cart-token-0001';

    // 1. Anonymous — add one item.
    const addAnon = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 2 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(addAnon.statusCode).toBe(200);

    // 2. Login as a customer who has their own cart (empty at this point).
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: 'happy@example.com', password: 'strong-password-1234!' },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(login.statusCode).toBe(200);

    // 3. Fetch current cart — the anonymous item must be present.
    const cart = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(cart.statusCode).toBe(200);
    const body = cart.json() as { data: Cart };
    expect(body.data.items.some((i) => i.productId === '00000000-0000-4000-8000-000000000101' && i.quantity >= 2)).toBe(true);
  });
});
