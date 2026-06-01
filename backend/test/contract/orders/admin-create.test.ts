import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { EventBus } from '../../../src/events/bus.js';
import { OrderService, type OrderEventBus } from '../../../src/modules/orders/services/order-service.js';
import { PaymentAdapterRegistry } from '../../../src/modules/payment_methods/services/payment-adapter-registry.js';
import { EnumOrderStatusRegistry } from '../../../src/modules/payment_methods/services/order-status-registry.port.js';
import { builtInPaymentAdapters } from '../../../src/modules/payments/adapters/built-in-adapters.js';

const SALES_CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';
const DELIVERY_ADDRESS_ID = '00000000-0000-4000-8000-0000000000d1';
const BILLING_ADDRESS_ID = '00000000-0000-4000-8000-0000000000d2';
const DELIVERY_METHOD_ID = '00000000-0000-4000-8000-0000000000e1';

/**
 * Feature 038 (US3) — a sales rep / admin builds an order for a customer; the
 * order is created on-behalf (status new, awaiting payment) and the customer
 * can pay it. Plus the FR-035 minimum-order-value gate.
 */
describe('Admin create order on behalf (US3)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates an order on behalf of the customer (status new, attributed to the admin)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: SALES_CHANNEL_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
        deliveryMethodId: DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: DELIVERY_ADDRESS_ID,
        billingAddressId: BILLING_ADDRESS_ID,
      },
    });
    expect(res.statusCode).toBe(201);
    const order = (res.json() as { data: { status: string; placedOnBehalfByAdminUserId: string | null } }).data;
    expect(order.status).toBe('new');
    expect(order.placedOnBehalfByAdminUserId).toBeTruthy();
  });

  it('blocks placement below the minimum order value (FR-035)', async () => {
    await seedCartForStubCustomer(h.em());
    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a);
    const service = new OrderService(h.em, new EventBus() as OrderEventBus, undefined, undefined, undefined, {
      paymentAdapters: registry,
      orderStatusRegistry: new EnumOrderStatusRegistry(),
      resolveMinOrderValue: async () => 999999,
    });

    await expect(
      service.placeOrder(
        { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
        {
          deliveryAddressId: DELIVERY_ADDRESS_ID,
          billingAddressId: BILLING_ADDRESS_ID,
          deliveryMethodId: DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});
