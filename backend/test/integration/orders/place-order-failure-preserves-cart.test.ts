import { Cart, CartItem } from '../../helpers/package-entities.js';
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

import { PaymentAdapterRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/payment-adapter-registry.js';

import { EnumOrderStatusRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/order-status-registry.port.js';

import { builtInPaymentAdapters } from '../../../src/modules/payments/adapters/built-in-adapters.js';

import { Order } from '../../../src/modules/orders/entities/order.entity.js';

import { orderServiceNeighbours } from '../../helpers/orders-neighbour-ports.js';


/**
 * Feature 036 (US4) — a failed placement (here: an address that does not belong
 * to the org) rolls back the transaction, so the cart is left byte-for-byte
 * unchanged and no Order is created. This is the invariant the Failure Page
 * relies on.
 */
describe('placeOrder — failure preserves the cart (feature 036)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('throws and leaves the cart active with no order on ADDRESS_NOT_OWNED', async () => {
    const before = await h.em().findOne(Cart, {
      customerAccountId: TEST_CUSTOMER_ID,
      status: 'active',
    });
    const itemsBefore = await h.em().find(CartItem, { cartId: before!.id });
    expect(itemsBefore.length).toBeGreaterThan(0);

    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a, 'payments');
    const service = new OrderService(
      h.em,
      new EventBus() as OrderEventBus,
      undefined,
      undefined,
      undefined,
      {
      neighbours: orderServiceNeighbours(h.em), paymentAdapters: registry, orderStatusRegistry: new EnumOrderStatusRegistry() },
    );

    await expect(
      service.placeOrder(
        { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
        {
          // A delivery address that does not belong to the caller's org → 403.
          deliveryAddressId: '00000000-0000-4000-8000-0000000000ff',
          billingAddressId: '00000000-0000-4000-8000-0000000000d2',
          deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    // Cart unchanged: still active, same line count.
    const after = await h.em().findOne(Cart, {
      customerAccountId: TEST_CUSTOMER_ID,
      status: 'active',
    });
    expect(after).not.toBeNull();
    const itemsAfter = await h.em().find(CartItem, { cartId: after!.id });
    expect(itemsAfter.length).toBe(itemsBefore.length);

    // No order created for this organization.
    const orders = await h.em().find(Order, { organizationId: TEST_ORGANIZATION_ID });
    expect(orders.length).toBe(0);

    // D-94.1 — and the completion pointer never appeared. `placeOrder` sets
    // `completedOrderId` beside `status = 'completed'`, on the placement
    // transaction, and `carts_completed_order_fk` is what makes that the only
    // place it can be set: the pointer cannot be written before the order
    // exists. A rolled-back placement therefore leaves it null, which is the
    // schema-level statement of what this test has always asserted.
    expect(after!.completedOrderId ?? null).toBeNull();
  });
});
