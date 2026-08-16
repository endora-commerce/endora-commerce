import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { EventBus } from '../../../src/events/bus.js';
import { OrderService, type OrderEventBus } from '../../../src/modules/orders/services/order-service.js';
import { PaymentAdapterRegistry } from '../../../src/modules/payment_methods/services/payment-adapter-registry.js';
import { EnumOrderStatusRegistry } from '../../../src/modules/payment_methods/services/order-status-registry.port.js';
import { builtInPaymentAdapters } from '../../../src/modules/payments/adapters/built-in-adapters.js';
import { PromotionService } from '../../../src/modules/promotions/services/promotion-service.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';

/**
 * Feature 036 (US3) — placeOrder recomputes the cart's coupon discount via the
 * promotion engine and stamps `promotionCode` + `discountTotal` on the Order,
 * with `total` reduced by the discount.
 */
describe('placeOrder — coupon discount stamped on the order (feature 036)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());

    // Arrange a 10%-off coupon and apply it to the stub customer's cart.
    const promotionService = new PromotionService(h.em);
    await promotionService.upsert({
      code: 'CHECKOUT10',
      name: 'Checkout 10% off',
      kind: 'percentage_off',
      value: 10,
    });
    const em = h.em();
    const cart = await em.findOne(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    cart!.appliedPromotionCode = 'CHECKOUT10';
    await em.persistAndFlush(cart!);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reflects the discount in promotionCode, discountTotal, and total', async () => {
    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a, 'payments');
    const service = new OrderService(
      h.em,
      new EventBus() as OrderEventBus,
      undefined,
      undefined,
      undefined,
      {
        paymentAdapters: registry,
        orderStatusRegistry: new EnumOrderStatusRegistry(),
        promotion: new PromotionService(h.em),
      },
    );

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

    expect(order.promotionCode).toBe('CHECKOUT10');
    expect(Number(order.discountTotal)).toBeCloseTo(expectedDiscount, 2);
    expect(expectedDiscount).toBeGreaterThan(0);

    // total = subtotal + tax + delivery + surcharge − discount
    const expectedTotal =
      Math.round(
        (subtotal +
          Number(order.taxTotal) +
          Number(order.deliveryTotal) -
          expectedDiscount) *
          100,
      ) / 100;
    expect(Number(order.total)).toBeCloseTo(expectedTotal, 2);
  });
});
