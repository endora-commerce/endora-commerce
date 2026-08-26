import { Cart, CartItem } from '../../helpers/package-entities.js';
import { randomUUID } from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

import { Order } from '../../../src/modules/orders/entities/order.entity.js';

import { OrderItem } from '../../../src/modules/orders/entities/order-item.entity.js';

import { cartWritePortOf, ordersNeighbourPorts } from '../../helpers/orders-neighbour-ports.js';

import { OrderReorderService } from '../../../src/modules/orders/services/order-reorder-service.js';

import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';

import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';


/**
 * Feature 038 (US6) — reorder rebuilds the cart from a past order, gated by
 * the reorder-enabled setting, reporting unavailable lines (FR-026).
 */
describe('Order reorder', () => {
  let h: BackendServerHandle;
  const ctx = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
  let orderId = '';
  const missingProductId = randomUUID();

  async function makeOrderWithItems(): Promise<string> {
    const em = h.em();
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: randomUUID(),
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
    const items = [
      em.create(OrderItem, {
        orderId: order.id,
        productId: SEED_PRODUCT_101_ID,
        productSnapshot: { sku: 'P101', name: 'Product 101', primaryAssetUrl: null },
        quantity: 2,
        unitPrice: '10.00',
        taxRate: '0.0000',
        lineTotal: '20.00',
      }),
      em.create(OrderItem, {
        orderId: order.id,
        productId: missingProductId,
        productSnapshot: { sku: 'GONE', name: 'Discontinued', primaryAssetUrl: null },
        quantity: 1,
        unitPrice: '10.00',
        taxRate: '0.0000',
        lineTotal: '10.00',
      }),
    ];
    await em.persistAndFlush(items);
    return order.id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    orderId = await makeOrderWithItems();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * Feature 075 — the service reseeds the cart through `carts`' published
   * `cartWritePort` instead of writing `Cart` and `CartItem` itself, and reads
   * the products and the buyer through their owners' ports. The real
   * implementations are used, so what this rig exercises is the same path the
   * composed service takes.
   */
  function reorderService(
    resolveReorderEnabled: (salesChannelId: string) => Promise<boolean>,
    mailer?: InMemoryMailer,
  ): OrderReorderService {
    const ports = ordersNeighbourPorts(h.em);
    return new OrderReorderService(
      h.em,
      cartWritePortOf(h),
      ports.catalogProductRead,
      ports.customerAccountRead,
      resolveReorderEnabled,
      mailer,
    );
  }

  it('rebuilds the cart from available items and reports the discontinued one', async () => {
    const svc = reorderService(async () => true);
    const result = await svc.reorder(orderId, ctx);
    expect(result.unavailableItems).toHaveLength(1);
    expect(result.unavailableItems[0]).toMatchObject({ productId: missingProductId, reason: 'discontinued' });

    const em = h.em();
    const cart = await em.findOne(Cart, { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID, status: 'active' });
    const cartItems = await em.find(CartItem, { cartId: cart!.id });
    expect(cartItems).toHaveLength(1);
    expect(cartItems[0]!.productId).toBe(SEED_PRODUCT_101_ID);
  });

  it('is refused when reorder is disabled for the scope (403)', async () => {
    const svc = reorderService(async () => false);
    await expect(svc.reorder(orderId, ctx)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('notifies the customer when reordered on their behalf', async () => {
    const acct = await h.em().findOne(CustomerAccount, { id: TEST_CUSTOMER_ID });
    const mailer = new InMemoryMailer();
    const svc = reorderService(async () => true, mailer);
    await svc.reorder(orderId, ctx, { notifyCustomer: true });
    if (acct?.email) {
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]!.to).toBe(acct.email);
    }
  });

  it('exposes the customer reorder endpoint', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/reorder`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { cartId: string; unavailableItems: unknown[] } }).data;
    expect(data.cartId).toBeTruthy();
    expect(Array.isArray(data.unavailableItems)).toBe(true);
  });

  it('exposes the admin reorder endpoint', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/reorder`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { cartId: string } }).data.cartId).toBeTruthy();
  });
});
