import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { moneyDifference } from '@endora-commerce/contracts';

import { Cart, Product, Promotion, Tax } from '../../helpers/package-entities.js';
import { seedBasePriceSql } from '../../helpers/price-book-sql.js';
import {
  seedCartForStubCustomer,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';

/**
 * Issue #1350 (owner ruling 2026-11-16) — a percent-off promotion takes its
 * percentage of the gross the buyer pays, and every surface that shows the
 * discount agrees with the order: the cart read, the admin cart detail, the
 * checkout preview and placement (whose total is what the payment takes).
 *
 * The basket is #436's mixed-rate one (23 % + 8 % + 5 %): net 96.29, gross
 * 111.77. 10 % of the gross is 11.18; 10 % of the net, the figure before the
 * ruling, was 9.63.
 *
 * Issue #1396 (owner ruling 2026-11-17) — a minimum spend compares the gross
 * too, and a fixed amount is capped at the gross, on the same surfaces: a
 * minimum of 100.00 is met by the gross 111.77 (the net 96.29 missed it), and
 * 500.00 off makes the goods free, VAT included.
 */

const SESSION = { b2b_session: 'stub-customer-session' };

interface AdminDetail {
  discount: { amount: number } | null;
  total: { amount: number };
  totalGross: { amount: number } | null;
}
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('#1350 / #1396 — promotions discount and compare the gross, on every surface', () => {
  let h: BackendServerHandle;
  let cartId: string;
  let stamp: string;
  let customer: { customerAccountId: string; organizationId: string; salesChannelId: string };
  const productIds: string[] = [];
  const promotionIds: string[] = [];
  const taxCodes: string[] = [];

  async function createProduct(type: 'simple' | 'virtual' | 'configurable', price: string, stamp: string) {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `GROSS1350-${type}-${stamp}`,
        type,
        name: `Gross ${type} ${stamp}`,
        description: '',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        status: 'active',
        ...(type === 'virtual' ? { downloadUrl: 'https://example.com/gross1350.pdf' } : {}),
      },
      cookies: ADMIN,
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    await h.em().nativeUpdate(Product, { id }, { manageStock: false });
    await seedBasePriceSql(h.em(), id, price);
    return id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    stamp = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    const em = h.em();
    for (const [productType, rate] of [
      ['simple', '0.2300'],
      ['virtual', '0.0800'],
      ['configurable', '0.0500'],
    ] as const) {
      const code = `gross1350-${productType}-${stamp}`;
      taxCodes.push(code);
      em.create(Tax, { code, name: code, rate, productType, priority: 1000 });
    }
    await em.flush();

    const simpleId = await createProduct('simple', '16.50', stamp);
    const virtualId = await createProduct('virtual', '8.25', stamp);
    const configurableId = await createProduct('configurable', '7.77', stamp);
    await (h.container as unknown as { resolve<T>(name: string): T })
      .resolve<{ handle: { pricingGeneration: { bump(): Promise<void> } } }>('priceLists')
      .handle.pricingGeneration.bump();

    // The seeded basket carries 2 × 19.99 of a simple product, at 23 %. A
    // promotion is bound to the system-default channel, and a cart that
    // resolved to no channel matches none (issue #251), so the basket is put
    // on that channel.
    await seedCartForStubCustomer(em);
    const salesChannelId = await systemDefaultSalesChannelId(em);
    const cart = await em.findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    cart.salesChannelId = salesChannelId;
    await em.persist(cart).flush();
    cartId = cart.id;
    customer = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID, salesChannelId };
    productIds.push(simpleId, virtualId, configurableId);
    await addMixedRateLines();

    // Above any promotion another file left behind, and the only one applied.
    const promotion = await promotionServiceFor(h).upsert({
      name: `10 % off ${stamp}`,
      priority: 1_000_000,
      stopFurther: true,
      action: { type: 'percentage_off_cart', percent: 10 },
      rule: { kind: 'all' },
    });
    promotionIds.push(promotion.id);
  }, 60_000);

  /** 1 × 16.50 at 23 %, 2 × 8.25 at 8 %, 3 × 7.77 at 5 % — beside the seeded 2 × 19.99 at 23 %. */
  async function addMixedRateLines() {
    const cartService = h.cartService()!;
    const [simpleId, virtualId, configurableId] = productIds as [string, string, string];
    await cartService.addItem({ customer }, { productId: simpleId, quantity: 1 });
    await cartService.addItem({ customer }, { productId: virtualId, quantity: 2 });
    await cartService.addItem({ customer }, { productId: configurableId, quantity: 3 });
  }

  async function placeOrder() {
    const place = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
      cookies: SESSION,
    });
    expect(place.statusCode, place.body).toBe(201);
    return (
      place.json() as {
        data: {
          subtotal: number;
          discountTotal: number;
          deliveryTotal: number;
          paymentSurcharge?: number;
          total: number;
        };
      }
    ).data;
  }

  afterAll(async () => {
    await h.em().nativeDelete(Promotion, { id: { $in: promotionIds } });
    await h.em().nativeDelete(Tax, { code: { $in: taxCodes } });
    await teardownBackendServer(h);
  });

  it('shows 10 % of the gross on the cart, the admin detail and the preview, and the order charges it', async () => {
    const view = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: SESSION });
    expect(view.statusCode, view.body).toBe(200);
    const cart = (
      view.json() as {
        data: {
          id: string;
          subtotal: { amount: number };
          discount: { amount: number } | null;
          grandTotal: { amount: number };
          vat: { subtotalGross: number; grandTotalGross: number } | null;
        };
      }
    ).data;
    expect(cart.id).toBe(cartId);
    expect(cart.subtotal.amount).toBe(96.29);
    expect(cart.vat?.subtotalGross).toBe(111.77);
    expect(cart.discount?.amount).toBe(11.18);
    expect(cart.vat?.grandTotalGross).toBe(100.59);
    // #1396 (option C) — the net after the discount, the discount taken off untaxed.
    expect(cart.grandTotal.amount).toBe(85.11);

    const admin = await h.app.inject({ method: 'GET', url: `/api/v1/admin/carts/${cartId}`, cookies: ADMIN });
    expect(admin.statusCode, admin.body).toBe(200);
    const detail = (admin.json() as { data: AdminDetail }).data;
    expect(detail.discount?.amount).toBe(11.18);
    expect(detail.total.amount).toBe(cart.grandTotal.amount);
    expect(detail.totalGross?.amount).toBe(cart.vat?.grandTotalGross);

    const preview = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      cookies: SESSION,
      payload: { deliveryMethodId: SEED_DELIVERY_METHOD_ID, paymentMethodId: SEED_PAYMENT_METHOD_ID },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const previewed = (preview.json() as { data: { discountTotal: number; total: number } }).data;
    expect(previewed.discountTotal).toBe(11.18);

    const order = await placeOrder();
    expect(order.discountTotal).toBe(11.18);
    expect(order.total).toBe(previewed.total);
    const beforeCheckoutCharges = moneyDifference(
      moneyDifference(order.total, order.deliveryTotal),
      order.paymentSurcharge ?? 0,
    );
    expect(Number(beforeCheckoutCharges)).toBe(cart.vat?.grandTotalGross);
    expect(Number(beforeCheckoutCharges)).toBe(detail.totalGross?.amount);
    // The net after the discount is the order's goods net less its discount line.
    expect(Number(moneyDifference(order.subtotal, order.discountTotal))).toBe(cart.grandTotal.amount);
  });

  it('meets a minimum spend with the gross and caps a fixed amount at the gross, on every surface (#1396)', async () => {
    // The first test placed its basket; a new one with the same lines, and
    // only this test's coupon promotions in play.
    await h.em().nativeDelete(Promotion, { id: { $in: promotionIds } });
    await seedCartForStubCustomer(h.em(), customer.salesChannelId);
    await addMixedRateLines();
    const newCart = await h.em().fork().findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    // A coupon code is upper case (`/^[A-Z0-9_-]{1,64}$/`).
    const highCode = `GROSS1396-HIGH-${stamp}`.toUpperCase();
    const metCode = `GROSS1396-${stamp}`.toUpperCase();
    const promotions = promotionServiceFor(h);
    const tooHigh = await promotions.upsert({
      code: highCode,
      name: `Over 120 ${stamp}`,
      priority: 1_000_000,
      stopFurther: true,
      minCartSubtotal: 120,
      action: { type: 'amount_off_cart', amount: 500, currency: 'PLN' },
      rule: { kind: 'all' },
    });
    const met = await promotions.upsert({
      code: metCode,
      name: `500 off over 100 ${stamp}`,
      priority: 1_000_000,
      stopFurther: true,
      minCartSubtotal: 100,
      action: { type: 'amount_off_cart', amount: 500, currency: 'PLN' },
      rule: { kind: 'all' },
    });
    promotionIds.push(tooHigh.id, met.id);

    // The gross 111.77 misses 120.00 by 8.23 — the shortfall is the gross one.
    const refused = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: { code: highCode },
      cookies: SESSION,
    });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(
      (refused.json() as { error: { details: { reason: string; shortfall?: { amount: number } } } }).error.details,
    ).toMatchObject({ reason: 'below_min_spend', shortfall: { amount: 8.23 } });

    // The net 96.29 missed 100.00; the gross 111.77 meets it.
    const applied = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: { code: metCode },
      cookies: SESSION,
    });
    expect(applied.statusCode, applied.body).toBe(200);

    const view = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: SESSION });
    expect(view.statusCode, view.body).toBe(200);
    const cart = (
      view.json() as {
        data: {
          id: string;
          couponDroppedThisRead: unknown;
          discount: { code: string | null; amount: number } | null;
          grandTotal: { amount: number };
          vat: { subtotalGross: number; grandTotalGross: number } | null;
        };
      }
    ).data;
    expect(cart.id).toBe(newCart.id);
    // The read keeps the code: the gross still meets the minimum.
    expect(cart.couponDroppedThisRead).toBeNull();
    expect(cart.discount).toMatchObject({ code: metCode, amount: 111.77 });
    expect(cart.vat?.subtotalGross).toBe(111.77);
    expect(cart.vat?.grandTotalGross).toBe(0);
    // The discount exceeds the net subtotal 96.29: the net after it reads 0, never below.
    expect(cart.grandTotal.amount).toBe(0);

    const admin = await h.app.inject({ method: 'GET', url: `/api/v1/admin/carts/${newCart.id}`, cookies: ADMIN });
    expect(admin.statusCode, admin.body).toBe(200);
    const detail = (admin.json() as { data: AdminDetail }).data;
    expect(detail.discount?.amount).toBe(111.77);
    expect(detail.total.amount).toBe(0);
    expect(detail.totalGross?.amount).toBe(0);

    const preview = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      cookies: SESSION,
      payload: { deliveryMethodId: SEED_DELIVERY_METHOD_ID, paymentMethodId: SEED_PAYMENT_METHOD_ID },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const previewed = (preview.json() as { data: { discountTotal: number; total: number } }).data;
    expect(previewed.discountTotal).toBe(111.77);

    const order = await placeOrder();
    expect(order.discountTotal).toBe(111.77);
    expect(order.total).toBe(previewed.total);
    // The goods are free, VAT included: only the checkout's charges are left.
    const beforeCheckoutCharges = moneyDifference(
      moneyDifference(order.total, order.deliveryTotal),
      order.paymentSurcharge ?? 0,
    );
    expect(Number(beforeCheckoutCharges)).toBe(0);
  });
});
