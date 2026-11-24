import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { QuoteRequest } from '../../helpers/package-entities.js';
import { QuoteRequestItem } from '../../helpers/package-entities.js';
import { Order, OrderItem } from '../../helpers/package-entities.js';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

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
    await em.persist(order).flush();
    await em.persist(
      em.create(OrderItem, {
        orderId: order.id,
        productId: SEED_PRODUCT_101_ID,
        productSnapshot: { sku: 'P101', name: 'Product 101', primaryAssetUrl: null },
        quantity: 2,
        unitPrice: '10.00',
        taxRate: '0.0000',
        lineTotal: '20.00',
      }),
    ).flush();
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

  /**
   * Feature 155, Phase 11 (T084) — the minimums follow the actor, not the code
   * path (FR-012, FR-030): the buyer's clone of an order holding A × 5 is
   * refused (US4 #5a); the representative's clone of it creates the request
   * and the admin read flags the line (US4 #15). The actor is a literal in each
   * route, never read from the request (threat F10).
   */
  describe('155 — order minimums', () => {
    const RUN = minimumFixtureRun();
    let A: MinimumProductFixture;
    let belowMinimumOrderId = '';

    beforeAll(async () => {
      const em = h.em();
      A = await createMinimumProduct(em, {
        sku: `CLQ-A-${RUN}`,
        nameEn: `Anchor ${RUN}`,
        namePl: `Kotwa ${RUN}`,
        minOrderQuantity: 10,
        channelIds: await buyerChannelIds(em),
      });
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
        subtotal: '50.00',
        taxTotal: '0.00',
        deliveryTotal: '0.00',
        total: '50.00',
        currency: 'PLN',
        placedAt: new Date(),
      });
      await em.persist(order).flush();
      await em.persist(
        em.create(OrderItem, {
          orderId: order.id,
          productId: A.id,
          productSnapshot: { sku: A.sku, name: A.nameEn, primaryAssetUrl: null },
          quantity: 5,
          unitPrice: '10.00',
          taxRate: '0.0000',
          lineTotal: '50.00',
        }),
      ).flush();
      belowMinimumOrderId = order.id;
    }, 60_000);

    const countRequests = async () => {
      const em = h.em();
      em.clear();
      return em.count(QuoteRequest, { customerAccountId: TEST_CUSTOMER_ID });
    };

    const expectAnchorRefused = (res: { statusCode: number; body: string; json: () => unknown }) => {
      expect(res.statusCode, res.body).toBe(422);
      const { error } = res.json() as { error: { code: string; message: string; details?: unknown } };
      expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
      expect(error.message).toContain(A.nameEn);
      expect(error.details).toMatchObject({
        lines: [{ index: 0, productId: A.id, productName: A.nameEn, kind: 'pieces', minimum: 10 }],
      });
    };

    it('US4 #5a — the buyer clone is refused 422 naming the line; no request is created', async () => {
      const before = await countRequests();
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orders/${belowMinimumOrderId}/clone-to-quote`,
        cookies: { b2b_session: 'stub-customer-session' },
      });
      expectAnchorRefused(res);
      expect(await countRequests()).toBe(before);
    });

    it('F10 — an actor in the buyer request body or query changes nothing', async () => {
      const before = await countRequests();
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/orders/${belowMinimumOrderId}/clone-to-quote?actor=operator&minimums=warn`,
        cookies: { b2b_session: 'stub-customer-session' },
        payload: { actor: 'operator', minimums: 'warn' },
      });
      expectAnchorRefused(res);
      expect(await countRequests()).toBe(before);
    });

    it('US4 #15 — the admin clone creates the request and the admin read warns on A', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${belowMinimumOrderId}/clone-to-quote`,
        cookies: { b2b_session: 'stub-admin-session' },
      });
      expect(res.statusCode, res.body).toBe(200);
      const { quoteRequestId } = (res.json() as { data: { quoteRequestId: string } }).data;
      const read = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/quote-requests/${quoteRequestId}`,
        cookies: { b2b_session: 'stub-admin-session' },
      });
      expect(read.statusCode, read.body).toBe(200);
      const items = (read.json() as { data: { items: Array<{ productId: string; quantity: number; minimumWarning?: unknown }> } })
        .data.items;
      expect(items.map((i) => [i.productId, i.quantity, i.minimumWarning])).toEqual([
        [A.id, 5, { kind: 'pieces', minimum: 10 }],
      ]);
    });
  });
});
