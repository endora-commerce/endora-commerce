import { Cart, CartItem } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_RFQ_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { LINE_QUANTITY_MAX } from '../../helpers/line-bounds.js';

/**
 * Issue #351, architect ruling R3 (a3) — signing in sums the anonymous
 * basket's lines into the customer's. Two lines each within the bound can sum
 * past it, and there is no request to refuse — failing the sign-in over it
 * would be worse — so the summed line is kept at `LINE_QUANTITY_MAX`. The one
 * place a line quantity is clamped rather than refused.
 */
describe('cart merge on login keeps a summed line at the bound (integration)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('customer 101×5 + anonymous 101×LINE_QUANTITY_MAX → 101×LINE_QUANTITY_MAX, sign-in succeeds', async () => {
    const em = h.em();
    const prior = await em.find(Cart, { customerAccountId: TEST_CUSTOMER_RFQ_ID, status: 'active' });
    for (const c of prior) await em.nativeDelete(CartItem, { cartId: c.id });
    await em.nativeDelete(Cart, { customerAccountId: TEST_CUSTOMER_RFQ_ID, status: 'active' });

    const custCart = em.create(Cart, {
      customerAccountId: TEST_CUSTOMER_RFQ_ID,
      organizationId: TEST_ORGANIZATION_ID,
      status: 'active',
      salesChannelId: await systemDefaultSalesChannelId(em),
    });
    await em.persistAndFlush(custCart);
    await em.persistAndFlush(
      em.create(CartItem, {
        cartId: custCart.id,
        productId: SEED_PRODUCT_101_ID,
        quantity: 5,
        unitPrice: '19.99',
        currency: 'PLN',
      }),
    );

    const anonToken = `anon-351-login-${Date.now()}`;
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: LINE_QUANTITY_MAX },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(added.statusCode, added.body).toBe(200);

    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: 'stub-customer-rfq@example.com', password: STUB_CUSTOMER_PASSWORD },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(login.statusCode, login.body).toBe(200);
    expect((login.json() as { data: { cartMerge?: { outcome: string } } }).data.cartMerge?.outcome).toBe('merged');

    em.clear();
    const items = await em.find(CartItem, { cartId: custCart.id });
    expect(items.map((i) => [i.productId, i.quantity])).toEqual([[SEED_PRODUCT_101_ID, LINE_QUANTITY_MAX]]);
  });
});
