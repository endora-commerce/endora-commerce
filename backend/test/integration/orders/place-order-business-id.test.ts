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
import { createBusinessIdGenerator } from '../../../src/modules/orders/services/business-id-generator.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';

/**
 * Feature 036 (US1) — placeOrder generates a customer-facing business Order ID
 * (prefix + sequence + suffix), surfaces the payment next-action, and clears
 * the cart to `completed`. The seeded payment method is the bank-transfer
 * adapter, so the next-action is `awaiting_transfer`.
 */
describe('placeOrder — business Order ID + nextAction (feature 036)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function buildService() {
    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a, 'payments');
    return new OrderService(
      h.em,
      new EventBus() as OrderEventBus,
      undefined,
      undefined,
      undefined,
      {
        // Issue #124 — a rig states its own tax authority. `OrderService` has no
        // fallback rate, so an order it cannot price is refused rather than taxed
        // at a figure nobody configured.
        resolveTaxRate: async () => 0.23,
        paymentAdapters: registry,
        orderStatusRegistry: new EnumOrderStatusRegistry(),
        // Prefix/suffix resolvers stand in for the SettingsService-backed ones.
        businessId: createBusinessIdGenerator({
          resolvePrefix: async () => 'ORD-',
          resolveSuffix: async () => '-2026',
        }),
      },
    );
  }

  it('stamps a prefixed/suffixed businessId, returns awaiting_transfer, and completes the cart', async () => {
    const order = await buildService().placeOrder(
      { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
      {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    );

    // Business Order ID: prefix + numeric sequence core + suffix; distinct from the UUID.
    expect(order.businessId).toMatch(/^ORD-\d+-2026$/);
    expect(order.businessId).not.toBe(order.id);

    // Bank-transfer adapter → awaiting_transfer next-action with the order total.
    expect(order.nextAction?.kind).toBe('awaiting_transfer');
    if (order.nextAction?.kind === 'awaiting_transfer') {
      expect(order.nextAction.accountDetails.amount).toBe(Number(order.total));
      expect(order.nextAction.accountDetails.currency).toBe(order.currency);
    }

    // Cart consumed.
    const cart = await h.em().findOne(Cart, { customerAccountId: TEST_CUSTOMER_ID });
    expect(cart?.status).toBe('completed');
  });
});
