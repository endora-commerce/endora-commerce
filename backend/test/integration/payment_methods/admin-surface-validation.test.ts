import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaymentAdapter } from '@b2b/contracts';
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

/**
 * T042 (US4/FR-015) — the selected payment method's adapter validator is
 * re-checked at submit. A method whose validateUseOnStorefront returns false is
 * rejected when a customer places the order.
 */
const blockingAdapter = (key: string): PaymentAdapter => ({
  adapterKey: key,
  type: 'bank_transfer',
  validateUseOnStorefront: async () => false,
  validateUseOnAdmin: async () => true,
  validateUseInApi: async () => true,
  onStorefrontOrderCreated: async () => ({ kind: 'none' }),
  onReceivePayment: async () => ({ result: 'success' }),
});

describe('placeOrder — payment-method submit re-validation', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('rejects a method whose storefront validator returns false', async () => {
    const registry = new PaymentAdapterRegistry();
    // The seed method's adapter is 'bank_transfer'; register a blocking one.
    registry.register(blockingAdapter('bank_transfer'), 'payments');

    const service = new OrderService(
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
      },
    );

    await expect(
      service.placeOrder(
        { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
        {
          deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
          billingAddressId: '00000000-0000-4000-8000-0000000000d2',
          deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
