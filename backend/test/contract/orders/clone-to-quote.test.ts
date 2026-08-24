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
import { QuoteRequest } from '../../helpers/package-entities.js';
import { QuoteRequestItem } from '../../helpers/package-entities.js';

/**
 * Feature 038 (US7) — cloning an order into a Quote Request via the RFQ module.
 */
describe('Order clone-to-quote', () => {
  let h: BackendServerHandle;
  let orderId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
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
      subtotal: '20.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '20.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    await em.persistAndFlush(
      em.create(OrderItem, {
        orderId: order.id,
        productId: SEED_PRODUCT_101_ID,
        productSnapshot: { sku: 'P101', name: 'Product 101', primaryAssetUrl: null },
        quantity: 2,
        unitPrice: '10.00',
        taxRate: '0.0000',
        lineTotal: '20.00',
      }),
    );
    orderId = order.id;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('admin clone creates a Quote Request with the order line items', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/clone-to-quote`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const { quoteRequestId } = (res.json() as { data: { quoteRequestId: string } }).data;
    expect(quoteRequestId).toBeTruthy();

    const em = h.em();
    const rfq = await em.findOne(QuoteRequest, { id: quoteRequestId });
    expect(rfq?.organizationId).toBe(TEST_ORGANIZATION_ID);
    const items = await em.find(QuoteRequestItem, { quoteRequestId });
    expect(items).toHaveLength(1);
    expect(items[0]!.productId).toBe(SEED_PRODUCT_101_ID);
    expect(items[0]!.quantity).toBe(2);
  });

  it('exposes the customer clone-to-quote endpoint', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/clone-to-quote`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { quoteRequestId: string } }).data.quoteRequestId).toBeTruthy();
  });
});
