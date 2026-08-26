import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
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
import { PaymentAdapterRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/payment-adapter-registry.js';
import { EnumOrderStatusRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/order-status-registry.port.js';
import { builtInPaymentAdapters } from '../../../src/modules/payments/adapters/built-in-adapters.js';
import { createBusinessIdGenerator } from '../../../src/modules/orders/services/business-id-generator.js';
import { orderServiceNeighbours } from '../../helpers/orders-neighbour-ports.js';

/**
 * Feature 051 US1 (T008/T009) — a B2C customer backed by a personal
 * organization transacts exactly like a company-org customer: ordering and RFQ
 * submission both succeed and never hit the `organizationId`-required 422 guard
 * (the personal org gives every customer a concrete, non-null org id).
 *
 * The seeded commerce org is flipped to `isPersonal = true` so the whole
 * order/RFQ path runs against a personal tenant.
 */
describe('B2C (personal-org) customer can transact (feature 051 US1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Make the seeded transacting org a personal (B2C) organization.
    const em = h.em();
    const org = await em.findOne(Organization, { id: TEST_ORGANIZATION_ID });
    org!.isPersonal = true;
    org!.status = 'active';
    await em.flush();
    await seedCartForStubCustomer(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function buildOrderService() {
    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a, 'payments');
    return new OrderService(h.em, new EventBus() as OrderEventBus, undefined, undefined, undefined, {
      neighbours: orderServiceNeighbours(h.em),
      // Issue #124 — a rig states its own tax authority. `OrderService` has no
      // fallback rate, so an order it cannot price is refused rather than taxed
      // at a figure nobody configured.
      resolveTaxRate: async () => 0.23,
      paymentAdapters: registry,
      orderStatusRegistry: new EnumOrderStatusRegistry(),
      businessId: createBusinessIdGenerator({
        resolvePrefix: async () => 'ORD-',
        resolveSuffix: async () => '-2026',
      }),
    });
  }

  it('places an order successfully — no organization_required 422 (T008)', async () => {
    const order = await buildOrderService().placeOrder(
      { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
      {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    );
    expect(order.id).toEqual(expect.any(String));
    expect(order.businessId).toMatch(/^ORD-\d+-2026$/);
    // The order is owned by the personal org — isolation is by the same tenant key.
    const persisted = await h.em().findOne(Organization, { id: TEST_ORGANIZATION_ID });
    expect(persisted!.isPersonal).toBe(true);
  });

  it('submits an RFQ successfully — no organization_required 422 (T009)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        headerNote: 'B2C personal-org RFQ',
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 25, desiredUnitPrice: 8.0 }],
      },
    });
    expect(res.statusCode).toBe(201);
  });
});
