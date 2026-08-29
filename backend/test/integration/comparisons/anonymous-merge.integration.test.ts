import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
} from '../../helpers/seed-catalog.js';
import { Comparison, ComparisonProduct } from '../../helpers/package-entities.js';

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

  // No `beforeEach` cleanup (issue #166): both cases below name the rows they
  // created by id, so "the anonymous comparison was reassigned" and "it was
  // discarded" are statements about those rows rather than about the table
  // holding exactly one.

  it('reassigns the anonymous Comparison when the customer has none', async () => {
    // "the customer has none" is this file's opening state, not something a
    // hook manufactures: `setupBackendServer` reseeds `customer_accounts` with
    // a fresh id per composition, and `comparisons` hangs off it, so the stub
    // customer starts owning nothing. The case below is the one that gives it a
    // comparison, which is why it runs second.
    // Build an anonymous comparison.
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
      payload: { productId: SEED_PRODUCT_101_ID },
    });
    const compareCookie = extractCookie(first.headers['set-cookie'], 'compare_token');
    expect(compareCookie).toBeTruthy();
    const anonymousId = (first.json() as { data: { id: string } }).data.id;

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

    // The anonymous-token row is now reassigned to the customer — the same
    // row, which is what "reassigned" means and what a count could not say.
    const em = h.em();
    const adopted = await em.findOne(Comparison, { id: anonymousId });
    expect(adopted, 'the anonymous comparison was deleted rather than adopted').not.toBeNull();
    // MikroORM hydrates a NULL optional column as `undefined`; both mean
    // "the anonymous token was cleared" (verified at the DB layer).
    expect(adopted!.anonymousToken ?? null).toBeNull();
    expect(adopted!.customerAccountId).not.toBeNull();
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

    const owned = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: {
        ...SALES_CHANNEL_HEADER,
        'content-type': 'application/json',
        cookie: `b2b_session=${session}`,
      },
      payload: { productId: SEED_PRODUCT_101_ID },
    });
    const customerComparisonId = (owned.json() as { data: { id: string } }).data.id;

    // Build an anonymous comparison in a separate "session" (no auth cookie).
    const anonAdd = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
      payload: { productId: SEED_PRODUCT_102_ID },
    });
    const compareCookie = extractCookie(anonAdd.headers['set-cookie'], 'compare_token');
    const anonymousId = (anonAdd.json() as { data: { id: string } }).data.id;

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
    expect(
      await em.findOne(Comparison, { id: anonymousId }),
      'the anonymous comparison survived the merge',
    ).toBeNull();
    const survivor = await em.findOne(Comparison, { id: customerComparisonId });
    expect(survivor, "the customer's own comparison was discarded").not.toBeNull();
    // MikroORM hydrates a NULL optional column as `undefined`; both mean
    // "the anonymous token was cleared" (verified at the DB layer).
    expect(survivor!.anonymousToken ?? null).toBeNull();
    expect(survivor!.customerAccountId).not.toBeNull();
    // The product on the surviving comparison is the customer's original
    // (101), not the anonymous one (102).
    const products = await em.find(ComparisonProduct, {
      comparisonId: survivor!.id,
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
