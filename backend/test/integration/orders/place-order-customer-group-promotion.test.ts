import { Cart, CartItem } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';

import { orderServiceNeighbours } from '../../helpers/orders-neighbour-ports.js';

import {
  TEST_CUSTOMER_ID,
  TEST_CUSTOMER_RFQ_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';

import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

import { EventBus } from '../../../src/events/bus.js';

import {
  OrderService,
  type OrderEventBus,
} from '../../../../packages/modules/orders/dist/backend/services/order-service.js';

import { PaymentAdapterRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/payment-adapter-registry.js';

import { EnumOrderStatusRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/order-status-registry.port.js';

import { builtInPaymentAdapters } from '../../../../packages/modules/payments/src/backend/adapters/built-in-adapters.js';

import { promotionServiceFor } from '../../helpers/promotion-service.js';

import { CustomerAccount } from '../../helpers/package-entities.js';

import { CustomerGroup } from '../../helpers/package-entities.js';


/**
 * Issue #177 — order placement prices a group-targeted promotion for the group
 * it targets.
 *
 * `OrderService.computeMonetaryTotals` built its `CartSnapshot` with a
 * hard-coded `customerGroupId: null`, and the usage context handed to
 * `finalizeUsage` carried the same `null`. So a promotion restricted to a
 * customer group never reduced an order total, and every redemption row said
 * the buyer belonged to no group.
 *
 * The two buyers below sit in the same Organization — which carries no group
 * of its own — and differ only in the group on their account, so the amount
 * charged is a statement about membership and nothing else.
 */
describe('placeOrder — customer-group targeted promotion (issue #177)', () => {
  let h: BackendServerHandle;
  let vipGroupId: string;
  let promotionId: string;

  beforeAll(async () => {
    h = await setupBackendServer();

    const em = h.em();
    const vip = em.create(CustomerGroup, { code: 'i177-vip', name: 'VIP (issue 177)' });
    const wholesale = em.create(CustomerGroup, {
      code: 'i177-wholesale',
      name: 'Wholesale (issue 177)',
    });
    await em.persistAndFlush([vip, wholesale]);
    vipGroupId = vip.id;

    const member = await em.findOne(CustomerAccount, { id: TEST_CUSTOMER_ID });
    member!.customerGroupId = vip.id;
    const outsider = await em.findOne(CustomerAccount, { id: TEST_CUSTOMER_RFQ_ID });
    outsider!.customerGroupId = wholesale.id;
    await em.persistAndFlush([member!, outsider!]);

    // Issue #251 — the promotion engine's channel gate is live in every
    // composition now (`salesChannelMembership` used to be optional and this
    // rig omitted it). `upsert` binds the promotion to the system-default
    // channel, and a cart that resolved to **no** channel matches no
    // channel-bound promotion — FR-005, fail closed. `seedCartForStubCustomer`
    // leaves `salesChannelId` unset, which no real cart is (D-47…D-51), so both
    // carts are placed in the default channel: the difference this file asserts
    // is the customer group and nothing else.
    const defaultChannelId = (await h.salesChannels.resolver.getSystemDefault()).id;

    await seedCartForStubCustomer(em);
    const memberCart = await em.findOne(Cart, {
      customerAccountId: TEST_CUSTOMER_ID,
      status: 'active',
    });
    memberCart!.salesChannelId = defaultChannelId;
    await em.persistAndFlush(memberCart!);

    const outsiderCart = em.create(Cart, {
      customerAccountId: TEST_CUSTOMER_RFQ_ID,
      organizationId: TEST_ORGANIZATION_ID,
      status: 'active',
      salesChannelId: defaultChannelId,
    });
    await em.persistAndFlush(outsiderCart);
    await em.persistAndFlush(
      em.create(CartItem, {
        cartId: outsiderCart.id,
        productId: SEED_PRODUCT_101_ID,
        quantity: 2,
        unitPrice: '19.99',
        currency: 'PLN',
      }),
    );

    const promotion = await promotionServiceFor(h).upsert({
      name: 'VIP 10% off',
      customerGroupId: vip.id,
      action: { type: 'percentage_off_cart', percent: 10 },
      rule: { kind: 'all' },
    });
    promotionId = promotion.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function orderService(): OrderService {
    const promotionService = promotionServiceFor(h);
    const registry = new PaymentAdapterRegistry();
    for (const a of builtInPaymentAdapters()) registry.register(a, 'payments');
    return new OrderService(h.em, new EventBus() as OrderEventBus, undefined, undefined, undefined, {
      neighbours: orderServiceNeighbours(h.em),
      // Issue #124 — a rig states its own tax authority.
      resolveTaxRate: async () => 0.23,
      paymentAdapters: registry,
      orderStatusRegistry: new EnumOrderStatusRegistry(),
      // D-94.5 split the seam in two: `promotion` is the read half
      // (`PromotionApplyPort.applyToCart`), `promotionUsageFinalizer` is the
      // redemption row written on the placement transaction. The same service
      // satisfies both, and this file asserts the row, so it wires both.
      promotion: promotionService,
      promotionUsageFinalizer: promotionService,
    });
  }

  const request = {
    deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
    billingAddressId: '00000000-0000-4000-8000-0000000000d2',
    deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
  };

  it('discounts the member order, leaves the outsider order at full price', async () => {
    const service = orderService();

    const memberOrder = await service.placeOrder(
      { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
      request,
    );
    const memberSubtotal = Number(memberOrder.subtotal);
    const expectedDiscount = Math.round(memberSubtotal * 0.1 * 100) / 100;
    expect(expectedDiscount).toBeGreaterThan(0);
    expect(Number(memberOrder.discountTotal)).toBeCloseTo(expectedDiscount, 2);
    expect(Number(memberOrder.total)).toBeCloseTo(
      Math.round(
        (memberSubtotal +
          Number(memberOrder.taxTotal) +
          Number(memberOrder.deliveryTotal) -
          expectedDiscount) *
          100,
      ) / 100,
      2,
    );

    const outsiderOrder = await service.placeOrder(
      { customerAccountId: TEST_CUSTOMER_RFQ_ID, organizationId: TEST_ORGANIZATION_ID },
      request,
    );
    expect(Number(outsiderOrder.discountTotal)).toBe(0);
    expect(Number(outsiderOrder.total)).toBeCloseTo(
      Math.round(
        (Number(outsiderOrder.subtotal) +
          Number(outsiderOrder.taxTotal) +
          Number(outsiderOrder.deliveryTotal)) *
          100,
      ) / 100,
      2,
    );

    // The redemption row records the group the discount was granted for; it was
    // written as `null` for every redemption before this fix.
    const usages = (await h
      .em()
      .getConnection()
      .execute(
        'select order_id, promotion_id, customer_group_id from promotion_usages where order_id in (?, ?)',
        [memberOrder.id, outsiderOrder.id],
      )) as Array<{
      order_id: string;
      promotion_id: string;
      customer_group_id: string | null;
    }>;
    expect(usages).toHaveLength(1);
    expect(usages[0]!.order_id).toBe(memberOrder.id);
    expect(usages[0]!.promotion_id).toBe(promotionId);
    expect(usages[0]!.customer_group_id).toBe(vipGroupId);
  });
});
