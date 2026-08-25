import { Cart, CartItem } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import {
  TEST_CUSTOMER_EMPTY_ID,
  TEST_CUSTOMER_RFQ_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';

import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';

import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';


/**
 * Feature 037-cart-merge-on-login — contract test for the customer-login
 * endpoint with the new `cartMerge` response field and `Set-Cookie`
 * cleanup behaviour. The tests exercise:
 *   - `outcome: 'adopted'` (US1) — no prior customer cart;
 *   - `outcome: 'merged'`  (US2) — pre-existing customer cart;
 *   - `outcome: 'noop'`    (FR-014) — anon cookie but empty source;
 *   - `cartMerge` absent   — no anon cookie at all;
 *   - failure isolation (FR-007/FR-008) — a thrown merge does not break login.
 */

interface LoginResponseBody {
  data: {
    customerAccount: { id: string };
    cartMerge?: { outcome: 'adopted' | 'merged' | 'noop'; destinationCartId: string } | null;
  };
}

function hasAnonClearCookie(setCookie: string[] | string | undefined): boolean {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return headers.some(
    (h) => /b2b_cart_anon=;/.test(h) && /(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(h),
  );
}

function collectSetCookie(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

describe('POST /api/v1/auth/customer/login — cart-merge response field', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('cartMerge.outcome = "adopted" when the customer had no prior cart, with b2b_cart_anon cleared', async () => {
    const em = h.em();
    // Ensure the actor has no prior active cart.
    const priors = await em.find(Cart, {
      customerAccountId: TEST_CUSTOMER_EMPTY_ID,
      status: 'active',
    });
    for (const c of priors) await em.nativeDelete(CartItem, { cartId: c.id });
    await em.nativeDelete(Cart, {
      customerAccountId: TEST_CUSTOMER_EMPTY_ID,
      status: 'active',
    });

    const anonToken = `anon-login-adopt-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add.statusCode).toBe(200);

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: {
        email: 'stub-customer-empty@example.com',
        password: STUB_CUSTOMER_PASSWORD,
      },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as LoginResponseBody;
    expect(body.data.cartMerge?.outcome).toBe('adopted');
    expect(body.data.cartMerge?.destinationCartId).toMatch(/^[0-9a-f-]{36}$/i);

    const setCookies = collectSetCookie(res.headers['set-cookie']);
    expect(hasAnonClearCookie(setCookies)).toBe(true);
  });

  it('cartMerge.outcome = "merged" when the customer already had an active cart', async () => {
    const em = h.em();
    // Wipe and reseed an existing cart for the RFQ actor (customer_accounts.id
    // unrelated to the customer-cart relationship — using the rfq actor to
    // isolate from the adopt test).
    const priors = await em.find(Cart, {
      customerAccountId: TEST_CUSTOMER_RFQ_ID,
      status: 'active',
    });
    for (const c of priors) await em.nativeDelete(CartItem, { cartId: c.id });
    await em.nativeDelete(Cart, {
      customerAccountId: TEST_CUSTOMER_RFQ_ID,
      status: 'active',
    });
    const custCart = em.create(Cart, {
      customerAccountId: TEST_CUSTOMER_RFQ_ID,
      organizationId: TEST_ORGANIZATION_ID,
      status: 'active',
    });
    await em.persistAndFlush(custCart);
    em.persist(
      em.create(CartItem, {
        cartId: custCart.id,
        productId: SEED_PRODUCT_101_ID,
        quantity: 2,
        unitPrice: '19.99',
        currency: 'PLN',
      }),
    );
    await em.flush();

    const anonToken = `anon-login-merge-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_102_ID, quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: {
        email: 'stub-customer-rfq@example.com',
        password: STUB_CUSTOMER_PASSWORD,
      },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as LoginResponseBody;
    expect(body.data.cartMerge?.outcome).toBe('merged');
    expect(body.data.cartMerge?.destinationCartId).toBe(custCart.id);
    expect(hasAnonClearCookie(collectSetCookie(res.headers['set-cookie']))).toBe(true);
  });

  it('cartMerge.outcome = "noop" when the anon cart exists but is empty', async () => {
    const em = h.em();
    const anonToken = `anon-login-noop-empty-${Date.now()}`;
    const anon = em.create(Cart, {
      anonymousCartToken: anonToken,
      status: 'active',
    });
    await em.persistAndFlush(anon);

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: {
        email: 'stub-customer-empty@example.com',
        password: STUB_CUSTOMER_PASSWORD,
      },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as LoginResponseBody;
    expect(body.data.cartMerge?.outcome).toBe('noop');
    // The token has just been consumed — the backend STILL clears the cookie
    // because the source row's token has been cleared (R-06 / data-model.md).
    expect(hasAnonClearCookie(collectSetCookie(res.headers['set-cookie']))).toBe(true);
  });

  it('cartMerge is absent when no b2b_cart_anon cookie was sent; no clear header', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: {
        email: 'stub-customer-empty@example.com',
        password: STUB_CUSTOMER_PASSWORD,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as LoginResponseBody;
    // No cookie ⇒ cartMerge is omitted (the route only adds the field when
    // the hook returned an outcome). `undefined` and `null` both satisfy
    // "absent" for the storefront, which treats them identically.
    expect(body.data.cartMerge ?? null).toBeNull();
    expect(hasAnonClearCookie(collectSetCookie(res.headers['set-cookie']))).toBe(false);
  });

  it('failure isolation (FR-007/FR-008) — a thrown merge does not break login, no cartMerge in body, no anon clear', async () => {
    const cs = h.cartService();
    expect(cs).not.toBeNull();
    const spy = vi
      .spyOn(cs!, 'mergeAnonymousIntoCustomer')
      .mockRejectedValueOnce(new Error('chaos'));

    try {
      const anonToken = `anon-chaos-${Date.now()}`;
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/customer/login',
        payload: {
          email: 'stub-customer-empty@example.com',
          password: STUB_CUSTOMER_PASSWORD,
        },
        cookies: { b2b_cart_anon: anonToken },
      });
      // Login itself still succeeds.
      expect(res.statusCode).toBe(200);
      const body = res.json() as LoginResponseBody;
      // No cartMerge field surfaces on failure — the storefront treats
      // absence as "nothing to flash".
      expect(body.data.cartMerge ?? null).toBeNull();
      // The anon cookie MUST survive the failure so the buyer can retry on a
      // subsequent login attempt (FR-008).
      expect(hasAnonClearCookie(collectSetCookie(res.headers['set-cookie']))).toBe(false);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});
