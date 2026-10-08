import { randomUUID } from 'node:crypto';
import { Cart, CartItem, Order, QuoteRequest } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  acceptedQuoteRequest,
  checkOutBasket,
  convertQuoteRequestToCart,
  whenOrderCreatedSettled,
} from '../../helpers/quote-conversion.js';


/**
 * T061 — Convert RFQ to order — integration.
 *
 * Approved RFQ → POST /convert-to-order → cart populated with one
 * line per RFQ item at the agreed unit price (SC-007). Verifies that
 * cart line `unitPrice` exactly matches the RFQ's `agreedUnitPrice`.
 */
describe('Convert RFQ to order — integration (US5)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('seeds the cart with the negotiated unit price (SC-007)', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 7, desiredUnitPrice: 12.0 },
        ],
      },
    });
    const rfq = (created.json() as { data: { id: string; version: number } }).data;

    // Admin modifies + customer accepts to get to Approved with a
    // distinct agreedUnitPrice.
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${rfq.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${rfq.version}"` },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 7, agreedUnitPrice: 11.25 }],
      },
    });
    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${rfq.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const cur = (detail.json() as { data: { currentRevisionNumber: number } }).data;
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${rfq.id}/accept-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { expectedRevisionNumber: cur.currentRevisionNumber },
    });

    const convert = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${rfq.id}/convert-to-order`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });
    expect(convert.statusCode).toBe(200);
    const { cartId } = (convert.json() as { data: { cartId: string } }).data;

    const cartItems = await h.em().find(CartItem, { cartId });
    expect(cartItems).toHaveLength(1);
    // Locked unit price flows through unchanged.
    expect(Number(cartItems[0]?.unitPrice)).toBe(11.25);
    expect(cartItems[0]?.quantity).toBe(7);
  });

  /**
   * `specs/143-crm-sales-opportunities/`, FR-100 and FR-104 — what the
   * conversion leaves on the basket, and what the placed order does to the
   * request. Until FR-100 the basket kept no word of the request, no order
   * named one, and the completion below never ran outside a fixture.
   */
  describe('the request and the order it becomes', () => {
    const quoteRow = async (id: string) => {
      const em = h.em();
      em.clear();
      return em.findOneOrFail(QuoteRequest, { id }, { filters: false });
    };

    const idle = () =>
      (
        h.container.resolve('quoteRequests') as { handle(): { orderCompletionReactor: { idle(): Promise<void> } } }
      )
        .handle()
        .orderCompletionReactor.idle();

    /** An order row naming `quoteRequestId`, written directly: the subject here is the reactor. */
    const orderNaming = (quoteRequestId: string, organizationId = TEST_ORGANIZATION_ID, id = randomUUID()) =>
      h.em().create(Order, {
        id,
        organizationId,
        placedByCustomerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: randomUUID(),
        deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
        billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
        deliveryMethodId: randomUUID(),
        deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
        paymentMethodId: randomUUID(),
        paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
        subtotal: '10.00',
        taxTotal: '0.00',
        deliveryTotal: '0.00',
        total: '10.00',
        currency: 'PLN',
        placedAt: new Date(),
        sourceQuoteRequestId: quoteRequestId,
      });

    it('the conversion marks the basket with the request it was seeded from', async () => {
      const rfq = await acceptedQuoteRequest(h);
      const cartId = await convertQuoteRequestToCart(h, rfq.id);
      const cart = await h.em().findOneOrFail(Cart, { id: cartId }, { filters: false });
      expect(cart.sourceQuoteRequestId).toBe(rfq.id);
    });

    it('checked out, the request is Completed and points at its order — and cannot be converted again', async () => {
      await h.em().execute(`update "stock_levels" set "on_hand" = 100000`);
      const rfq = await acceptedQuoteRequest(h);
      await convertQuoteRequestToCart(h, rfq.id);
      const placed = await whenOrderCreatedSettled(h, () => checkOutBasket(h));
      await idle();

      const quote = await quoteRow(rfq.id);
      expect(quote.status).toBe('Completed');
      expect(quote.convertedOrderId).toBe(placed.id);
      const again = await h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${rfq.id}/convert-to-order`,
        cookies: { b2b_session: 'stub-customer-session' },
        payload: {},
      });
      expect(again.statusCode, again.body).toBe(409);
    });

    it('an order whose commit lands after its event still completes the request (the lost race)', async () => {
      const rfq = await acceptedQuoteRequest(h);
      const orderId = randomUUID();
      // The event first, as a placement announces it from inside its own
      // transaction; the row a moment later, as its commit lands.
      h.eventBus.emit('order.created.v1' as never, { orderId } as never);
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect((await quoteRow(rfq.id)).status).toBe('Approved');
      const em = h.em();
      em.persist(orderNaming(rfq.id, TEST_ORGANIZATION_ID, orderId));
      await em.flush();

      await idle();
      const quote = await quoteRow(rfq.id);
      expect(quote.status).toBe('Completed');
      expect(quote.convertedOrderId).toBe(orderId);
    });

    it('an order of another Organization naming the request completes nothing', async () => {
      const rfq = await acceptedQuoteRequest(h);
      const em = h.em();
      const order = orderNaming(rfq.id, OTHER_TEST_ORGANIZATION_ID);
      em.persist(order);
      await em.flush();
      await whenOrderCreatedSettled(h, async () => {
        h.eventBus.emit('order.created.v1' as never, { orderId: order.id } as never);
      });
      await idle();
      const quote = await quoteRow(rfq.id);
      expect(quote.status).toBe('Approved');
      expect(quote.convertedOrderId ?? null).toBeNull();
    });
  });
});
