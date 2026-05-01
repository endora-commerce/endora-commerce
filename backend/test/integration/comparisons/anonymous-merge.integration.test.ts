import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
} from '../../helpers/seed-catalog.js';
import { Comparison } from '../../../src/modules/comparisons/entities/comparison.entity.js';
import { ComparisonProduct } from '../../../src/modules/comparisons/entities/comparison-product.entity.js';

/**
 * T070 — R-2 / FR-005 anonymous → authenticated Comparison adoption.
 * Two cases:
 *   - Customer with no Comparison: the anonymous Comparison is reassigned
 *     (customer_account_id set, anonymous_token cleared).
 *   - Customer with an existing Comparison: the anonymous one is
 *     discarded; the customer's curated set wins.
 */

const SALES_CHANNEL_HEADER = { 'x-sales-channel': 'pl_retail' };
const STUB_CUSTOMER_EMAIL = 'stub-customer@example.com';
const STUB_CUSTOMER_PASSWORD = 'stub-password-change-me-1234';

describe('Compare module — anonymous→authenticated merge (Phase 8 / T070)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    const em = h.em();
    await em.nativeDelete(ComparisonProduct, {});
    await em.nativeDelete(Comparison, {});
  });

  it('reassigns the anonymous Comparison when the customer has none', async () => {
    // Build an anonymous comparison.
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
      payload: { productId: SEED_PRODUCT_101_ID },
    });
    const compareCookie = extractCookie(first.headers['set-cookie'], 'compare_token');
    expect(compareCookie).toBeTruthy();

    // Sign the customer in carrying the compare_token cookie.
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: {
        email: STUB_CUSTOMER_EMAIL,
        password: STUB_CUSTOMER_PASSWORD,
      },
      cookies: { compare_token: compareCookie },
    });
    expect(login.statusCode).toBe(200);

    // The anonymous-token row is now reassigned to the customer.
    const em = h.em();
    const rows = await em.find(Comparison, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.anonymousToken).toBeNull();
    expect(rows[0]!.customerAccountId).not.toBeNull();
  });

  it('discards the anonymous Comparison when the customer already has one', async () => {
    // Build an authenticated comparison first (login → POST with session).
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: {
        email: STUB_CUSTOMER_EMAIL,
        password: STUB_CUSTOMER_PASSWORD,
      },
    });
    expect(login.statusCode).toBe(200);
    const session = extractCookie(login.headers['set-cookie'], 'b2b_session');

    await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: {
        ...SALES_CHANNEL_HEADER,
        'content-type': 'application/json',
        cookie: `b2b_session=${session}`,
      },
      payload: { productId: SEED_PRODUCT_101_ID },
    });

    // Build an anonymous comparison in a separate "session" (no auth cookie).
    const anonAdd = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
      payload: { productId: SEED_PRODUCT_102_ID },
    });
    const compareCookie = extractCookie(anonAdd.headers['set-cookie'], 'compare_token');

    // Sign the same customer back in carrying both cookies — the merge
    // hook fires and discards the anonymous one.
    const login2 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: {
        email: STUB_CUSTOMER_EMAIL,
        password: STUB_CUSTOMER_PASSWORD,
      },
      cookies: { compare_token: compareCookie },
    });
    expect(login2.statusCode).toBe(200);

    const em = h.em();
    const rows = await em.find(Comparison, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.anonymousToken).toBeNull();
    expect(rows[0]!.customerAccountId).not.toBeNull();
    // The product on the surviving comparison is the customer's original
    // (101), not the anonymous one (102).
    const products = await em.find(ComparisonProduct, {
      comparisonId: rows[0]!.id,
    });
    expect(products.map((p) => p.productId)).toEqual([SEED_PRODUCT_101_ID]);
  });
});

function extractCookie(setCookie: string | string[] | undefined, name: string): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const raw of cookies) {
    const match = new RegExp(`${name}=([^;]+)`).exec(raw);
    if (match?.[1]) return match[1];
  }
  return '';
}
