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
 */

const SESSION = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('#1350 — a percent-off promotion discounts the gross, on every surface', () => {
  let h: BackendServerHandle;
  let cartId: string;
  let promotionId: string;
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
    const stamp = `${Date.now()}-${randomUUID().slice(0, 6)}`;
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
    await em.persistAndFlush(cart);
    cartId = cart.id;
    const customer = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID, salesChannelId };
    const cartService = h.cartService()!;
    await cartService.addItem({ customer }, { productId: simpleId, quantity: 1 });
    await cartService.addItem({ customer }, { productId: virtualId, quantity: 2 });
    await cartService.addItem({ customer }, { productId: configurableId, quantity: 3 });

    // Above any promotion another file left behind, and the only one applied.
    const promotion = await promotionServiceFor(h).upsert({
      name: `10 % off ${stamp}`,
      priority: 1_000_000,
      stopFurther: true,
      action: { type: 'percentage_off_cart', percent: 10 },
      rule: { kind: 'all' },
    });
    promotionId = promotion.id;
  }, 60_000);

  afterAll(async () => {
    await h.em().nativeDelete(Promotion, { id: promotionId });
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
          vat: { subtotalGross: number; grandTotalGross: number } | null;
        };
      }
    ).data;
    expect(cart.id).toBe(cartId);
    expect(cart.subtotal.amount).toBe(96.29);
    expect(cart.vat?.subtotalGross).toBe(111.77);
    expect(cart.discount?.amount).toBe(11.18);
    expect(cart.vat?.grandTotalGross).toBe(100.59);

    const admin = await h.app.inject({ method: 'GET', url: `/api/v1/admin/carts/${cartId}`, cookies: ADMIN });
    expect(admin.statusCode, admin.body).toBe(200);
    expect((admin.json() as { data: { discount: { amount: number } | null } }).data.discount?.amount).toBe(11.18);

    const preview = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      cookies: SESSION,
      payload: { deliveryMethodId: SEED_DELIVERY_METHOD_ID, paymentMethodId: SEED_PAYMENT_METHOD_ID },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const previewed = (preview.json() as { data: { discountTotal: number; total: number } }).data;
    expect(previewed.discountTotal).toBe(11.18);

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
    const order = (
      place.json() as {
        data: { discountTotal: number; deliveryTotal: number; paymentSurcharge?: number; total: number };
      }
    ).data;
    expect(order.discountTotal).toBe(11.18);
    expect(order.total).toBe(previewed.total);
    const beforeCheckoutCharges = moneyDifference(
      moneyDifference(order.total, order.deliveryTotal),
      order.paymentSurcharge ?? 0,
    );
    expect(Number(beforeCheckoutCharges)).toBe(cart.vat?.grandTotalGross);
  });
});
