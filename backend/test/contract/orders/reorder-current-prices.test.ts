import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrganizationPermissionPort } from '@endora-commerce/contracts';

import { Cart, CartItem, Order, OrderItem } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { cartWritePortOf, ordersNeighbourPorts } from '../../helpers/orders-neighbour-ports.js';
import {
  createTieredProduct,
  createUnpricedProduct,
  TIER_UNIT_PRICE,
} from '../../helpers/tiered-product-fixture.js';
import { OrderReorderService } from '../../../../packages/modules/orders/dist/backend/services/order-reorder-service.js';

/**
 * Issue #166 — a reorder is priced at **today's** prices, and a line that no
 * longer has one is reported, the way a discontinued product already is.
 *
 * The past order carries a price no list charges any more (`10.00`) for a
 * product the buyer's list now prices at `TIER_UNIT_PRICE`, and a line for a
 * product nothing prices for this buyer. The rebuilt basket holds the first at
 * its current price and leaves the second out; the response names the second
 * with `reason: 'no_price'` in `unavailableItems`. Before, the unpriced line was
 * seeded at the old order's price — silently, since only discontinued products
 * were reported — and placement then refused a basket the buyer had not been
 * told about.
 */
describe('Order reorder — current prices, and lines with none reported (#166)', () => {
  let h: BackendServerHandle;
  let ctx: { customerAccountId: string; organizationId: string; salesChannelId: string };
  let pricedProductId: string;
  let unpricedProductId: string;
  let orderId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    ctx = {
      customerAccountId: TEST_CUSTOMER_ID,
      organizationId: TEST_ORGANIZATION_ID,
      salesChannelId: await systemDefaultSalesChannelId(h.em()),
    };
    const stamp = `${Date.now()}-${randomUUID().slice(0, 6)}`;
    pricedProductId = await createTieredProduct(h, `reorder-${stamp}`);
    unpricedProductId = await createUnpricedProduct(h, `reorder-${stamp}`);

    const em = h.em();
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: ctx.salesChannelId,
      status: 'completed',
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
      subtotal: '30.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '30.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    em.create(OrderItem, {
      orderId: order.id,
      productId: pricedProductId,
      productSnapshot: { sku: 'PRICED', name: 'Priced', primaryAssetUrl: null },
      quantity: 2,
      unitPrice: '10.00',
      taxRate: '0.0000',
      lineTotal: '20.00',
    });
    em.create(OrderItem, {
      orderId: order.id,
      productId: unpricedProductId,
      productSnapshot: { sku: 'UNPRICED', name: 'Unpriced', primaryAssetUrl: null },
      quantity: 1,
      unitPrice: '10.00',
      taxRate: '0.0000',
      lineTotal: '10.00',
    });
    await em.flush();
    orderId = order.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('seeds the priced line at its current price and reports the unpriced one', async () => {
    const ports = ordersNeighbourPorts(h.em);
    const service = new OrderReorderService(
      h.em,
      cartWritePortOf(h),
      ports.catalogProductRead,
      ports.customerAccountRead,
      h.container.resolve<OrganizationPermissionPort>('organizationPermissionPort'),
      async () => true,
    );

    const result = await service.reorder(orderId, ctx);

    expect(result.unavailableItems).toEqual([
      { productId: unpricedProductId, variantId: null, reason: 'no_price' },
    ]);

    const em = h.em();
    em.clear();
    const cart = await em.findOneOrFail(Cart, { id: result.cartId });
    const items = await em.find(CartItem, { cartId: cart.id });
    expect(items.map((it) => it.productId)).toEqual([pricedProductId]);
    // Today's price, not the old order's 10.00.
    expect(Number(items[0]!.unitPrice).toFixed(2)).toBe(TIER_UNIT_PRICE);
    expect(items[0]!.quantity).toBe(2);
  });
});
