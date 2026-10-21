import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PAYMENT_METHOD_ID, seedCartForStubCustomer } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { CartItem, OrderItem, Product } from '../../helpers/package-entities.js';
import { EventBus } from '@endora-commerce/platform/events';
import { OrderService, type OrderEventBus } from '../../../../packages/modules/orders/dist/backend/services/order-service.js';
import { PaymentAdapterRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/payment-adapter-registry.js';
import { EnumOrderStatusRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/order-status-registry.port.js';
import { builtInPaymentAdapters } from '../../../../packages/modules/payments/src/backend/adapters/built-in-adapters.js';
import { createBusinessIdGenerator } from '../../../../packages/modules/orders/dist/backend/services/business-id-generator.js';
import { orderServiceNeighbours } from '../../helpers/orders-neighbour-ports.js';

/**
 * Feature 160 (FR-030) — a cart line records which tier priced it
 * (`cart_items.price_source`), written with its unit price, and the order line
 * placed from it keeps it (`order_items.price_source`).
 */
describe('orders — an order line keeps the price source of its cart line', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
    // Stock is not what this file is about: the seeded cart already holds the seed stock.
    await h.em().nativeUpdate(Product, { id: { $ne: null } }, { manageStock: false });
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('records the tier on add and copies it at placement', async () => {
    const customer = {
      customerAccountId: TEST_CUSTOMER_ID,
      organizationId: TEST_ORGANIZATION_ID,
      salesChannelId: await systemDefaultSalesChannelId(h.em()),
    };
    await h.cartService()!.addItem({ customer }, { productId: SEED_PRODUCT_102_ID, quantity: 1 });
    const line = await h.em().fork().findOneOrFail(CartItem, { productId: SEED_PRODUCT_102_ID });
    expect(line.priceSource).toBe('base');

    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a, 'payments');
    const orders = new OrderService(h.em, new EventBus() as OrderEventBus, undefined, undefined, undefined, {
      neighbours: orderServiceNeighbours(h.em),
      resolveTaxRate: async () => 0.23,
      paymentAdapters: () => registry,
      orderStatusRegistry: () => new EnumOrderStatusRegistry(),
      businessId: createBusinessIdGenerator({ resolvePrefix: async () => 'ORD-', resolveSuffix: async () => '' }),
    });
    const order = await orders.placeOrder(
      { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
      {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    );
    const items = await h.em().fork().find(OrderItem, { orderId: order.id });
    expect(items.find((i) => i.productId === SEED_PRODUCT_102_ID)?.priceSource).toBe('base');
  });
});
