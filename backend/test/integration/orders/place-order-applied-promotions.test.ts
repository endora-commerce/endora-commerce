import { Cart } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';

import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

import { EventBus } from '../../../src/events/bus.js';

import { OrderService, type OrderEventBus } from '../../../../packages/modules/orders/dist/backend/services/order-service.js';

import { PaymentAdapterRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/payment-adapter-registry.js';

import { EnumOrderStatusRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/order-status-registry.port.js';

import { builtInPaymentAdapters } from '../../../../packages/modules/payments/src/backend/adapters/built-in-adapters.js';

import { promotionServiceFor } from '../../helpers/promotion-service.js';


import { orderServiceNeighbours } from '../../helpers/orders-neighbour-ports.js';
import { OrderAppliedPromotion } from '../../helpers/package-entities.js';


/**
 * Feature 045 (US2) — an automatic action-based promotion carries from cart to
 * order: discountTotal is stamped and an order_applied_promotions row is written
 * even though no coupon was applied to the cart.
 */
describe('placeOrder — automatic promotion carried to order (feature 045)', () => {
  let h: BackendServerHandle;
  let promotionId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await seedCartForStubCustomer(em);
    // Issue #251 — the promotion engine's channel gate is live in every
    // composition now (`salesChannelMembership` used to be optional and this
    // rig omitted it). `upsert` binds the promotion to the system-default
    // channel, and a cart that resolved to **no** channel matches no
    // channel-bound promotion — FR-005, fail closed. `seedCartForStubCustomer`
    // leaves `salesChannelId` unset, which no real cart is (D-47…D-51), so the
    // cart is placed in the default channel here.
    const cart = await em.findOne(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    cart!.salesChannelId = (await h.salesChannels.resolver.getSystemDefault()).id;
    await em.persistAndFlush(cart!);

    const promotionService = promotionServiceFor(h);
    const promo = await promotionService.upsert({
      name: 'Auto 10% off',
      action: { type: 'percentage_off_cart', percent: 10 },
      rule: { kind: 'all' },
    });
    promotionId = promo.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('stamps discountTotal and an order_applied_promotions row', async () => {
    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a, 'payments');
    const service = new OrderService(h.em, new EventBus() as OrderEventBus, undefined, undefined, undefined, {
      neighbours: orderServiceNeighbours(h.em),
      // Issue #124 — a rig states its own tax authority. `OrderService` has no
      // fallback rate, so an order it cannot price is refused rather than taxed
      // at a figure nobody configured.
      resolveTaxRate: async () => 0.23,
      paymentAdapters: registry,
      orderStatusRegistry: new EnumOrderStatusRegistry(),
      promotion: promotionServiceFor(h),
    });

    const order = await service.placeOrder(
      { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
      {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    );

    const subtotal = Number(order.subtotal);
    const expectedDiscount = Math.round(subtotal * 0.1 * 100) / 100;
    expect(expectedDiscount).toBeGreaterThan(0);
    expect(Number(order.discountTotal)).toBeCloseTo(expectedDiscount, 2);

    const rows = await h.em().find(OrderAppliedPromotion, { orderId: order.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.promotionId).toBe(promotionId);
    expect(Number(rows[0]!.amount)).toBeCloseTo(expectedDiscount, 2);
  });
});
