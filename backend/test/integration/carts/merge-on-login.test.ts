import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';
import { CartItem } from '../../../src/modules/carts/entities/cart-item.entity.js';
import { CartAuditEntry } from '../../../src/modules/carts/entities/cart-audit-entry.entity.js';
import {
  TEST_CUSTOMER_RFQ_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';

/**
 * End-to-end integration test for the cart-merge-on-login flow
 * (feature 037-cart-merge-on-login § US2 / quickstart Scenario B).
 *
 * Drives the real Fastify app against a real Postgres + MikroORM and
 * asserts the full two-cart → one-cart transition: the customer's
 * existing cart absorbs the anon cart's lines (summed on matching
 * `(productId, variantId)`), the anon cart is detokenised + flipped to
 * `completed`, and a `cart_merged_from_anon` audit row lands on the
 * destination with the expected metadata.
 */

describe('cart merges anon→customer on login (integration)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('quickstart Scenario B — A×2,B×1 + A×3,C×4 → A×5,B×1,C×4 (one audit row)', async () => {
    const em = h.em();

    // 1. Reset the RFQ actor's cart state, then seed A×2, B×1.
    const priorCarts = await em.find(Cart, {
      customerAccountId: TEST_CUSTOMER_RFQ_ID,
      status: 'active',
    });
    for (const c of priorCarts) await em.nativeDelete(CartItem, { cartId: c.id });
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
    em.persist(
      em.create(CartItem, {
        cartId: custCart.id,
        productId: SEED_PRODUCT_102_ID,
        quantity: 1,
        unitPrice: '19.99',
        currency: 'PLN',
      }),
    );
    await em.flush();
    const auditBefore = await em.count(CartAuditEntry, {
      cartId: custCart.id,
      action: 'cart_merged_from_anon',
    });

    // 2. Anonymous browser session adds A×3 and product 103 (which plays the
    //    "C" role in the quickstart scenario; only the role matters).
    const anonToken = `anon-integ-${Date.now()}`;
    const addA = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 3 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(addA.statusCode).toBe(200);
    const addC = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      // Re-use SEED_PRODUCT_101's sibling 102 for "B" and add a third
      // line via a foundation product. The exact id doesn't matter
      // for the merge logic — only product equality vs the customer
      // cart's lines does.
      payload: { productId: '00000000-0000-4000-8000-000000000103', quantity: 4 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(addC.statusCode).toBe(200);
    const anonBefore = await em.findOne(Cart, {
      anonymousCartToken: anonToken,
      status: 'active',
    });
    expect(anonBefore).not.toBeNull();
    const sourceCartId = anonBefore!.id;

    // 3. Log in — the route should merge.
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: {
        email: 'stub-customer-rfq@example.com',
        password: STUB_CUSTOMER_PASSWORD,
      },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = login.json() as {
      data: {
        cartMerge?: { outcome: 'adopted' | 'merged' | 'noop'; destinationCartId: string };
      };
    };
    expect(loginBody.data.cartMerge?.outcome).toBe('merged');
    expect(loginBody.data.cartMerge?.destinationCartId).toBe(custCart.id);

    // 4. The destination cart now holds A×5, B×1, C×4.
    em.clear();
    const dest = await em.findOne(Cart, { id: custCart.id });
    expect(dest?.status).toBe('active');
    const items = await em.find(CartItem, { cartId: custCart.id });
    const byProduct = new Map(items.map((i) => [i.productId, i.quantity]));
    expect(byProduct.get(SEED_PRODUCT_101_ID)).toBe(5);
    expect(byProduct.get(SEED_PRODUCT_102_ID)).toBe(1);
    expect(byProduct.get('00000000-0000-4000-8000-000000000103')).toBe(4);

    // 5. The source anon cart is `completed` with the token cleared.
    const source = await em.findOne(Cart, { id: sourceCartId });
    expect(source?.status).toBe('completed');
    expect(source?.anonymousCartToken ?? null).toBeNull();

    // 6. Exactly one new audit row landed on the destination with the
    //    right outcome + counters.
    const auditAfter = await em.find(CartAuditEntry, {
      cartId: custCart.id,
      action: 'cart_merged_from_anon',
    });
    expect(auditAfter.length).toBe(auditBefore + 1);
    const latest = auditAfter[auditAfter.length - 1]!;
    const md = latest.metadata as Record<string, unknown>;
    expect(md['outcome']).toBe('merged');
    expect(md['movedLineCount']).toBe(1); // product 103
    expect(md['summedLineCount']).toBe(1); // product 101 (B was not in the anon cart)

    // 7. The login response cleared the stale anon cookie.
    const setCookies = collectSetCookie(login.headers['set-cookie']);
    expect(setCookies.some((s) => /b2b_cart_anon=;/.test(s) && /Max-Age=0/i.test(s))).toBe(true);
  });
});

function collectSetCookie(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}
