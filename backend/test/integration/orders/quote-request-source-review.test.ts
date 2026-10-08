import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OrderPlacementPort } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart, Order, OrderItem, QuoteRequest, StockLevel } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_CUSTOMER_RFQ_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { acceptedQuoteRequest, whenOrderCreatedSettled } from '../../helpers/quote-conversion.js';

/** The Organization's administrator — may convert any request of the Organization. */
const ORG_ADMIN = { b2b_session: 'stub-customer-session' };
const OTHER_ORG_CUSTOMER = { b2b_session: 'stub-customer-session-other-org' };

const PLACEMENT = {
  deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
  billingAddressId: SEED_ADDRESS_BILLING_ID,
  deliveryMethodId: SEED_DELIVERY_METHOD_ID,
  paymentMethodId: SEED_PAYMENT_METHOD_ID,
};

/**
 * What an independent review of FR-100 … FR-104 found the first suite did not
 * hold (`specs/143-crm-sales-opportunities/`, research N-QSR2).
 *
 * `place-order-from-quote-request.test.ts` walks one buyer and one basket. The
 * cases here are the ones that need a placement that runs wider than one
 * Organization, or a basket whose agreed line was swapped for a list-priced
 * one without the basket ever being empty.
 */
describe('orders — the quote-request source, under review', () => {
  let h: BackendServerHandle;

  const orderRow = async (orderId: string) => {
    const em = h.em();
    em.clear();
    return em.findOneOrFail(Order, { id: orderId }, { filters: false });
  };

  const quoteRow = async (quoteRequestId: string) => {
    const em = h.em();
    em.clear();
    return em.findOneOrFail(QuoteRequest, { id: quoteRequestId }, { filters: false });
  };

  const reactorIdle = () =>
    (h.container.resolve('quoteRequests') as { handle(): { orderCompletionReactor: { idle(): Promise<void> } } })
      .handle()
      .orderCompletionReactor.idle();

  const convert = async (quoteRequestId: string, cookies: Record<string, string>) => {
    const converted = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${quoteRequestId}/convert-to-order`,
      cookies,
      payload: {},
    });
    expect(converted.statusCode, converted.body).toBe(200);
    return (converted.json() as { data: { cartId: string } }).data.cartId;
  };

  const checkOut = async (cookies: Record<string, string>) => {
    const placed = await h.app.inject({ method: 'POST', url: '/api/v1/orders', cookies, payload: PLACEMENT });
    expect(placed.statusCode, placed.body).toBe(201);
    return (placed.json() as { data: { id: string } }).data.id;
  };

  const forgeBasketSource = async (customerAccountId: string, quoteRequestId: string) => {
    const em = h.em();
    em.clear();
    const cart = await em.findOneOrFail(Cart, { customerAccountId, status: 'active' }, { filters: false });
    cart.sourceQuoteRequestId = quoteRequestId;
    await em.flush();
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    em.create(StockLevel, {
      productId: SEED_PRODUCT_102_ID,
      warehouseId: '00000000-0000-4000-8000-00000000d017',
      onHand: 100,
      reserved: 0,
    });
    await em.flush();
    await em.execute(`update "stock_levels" set "on_hand" = 100000`);
  });

  beforeEach(async () => {
    await h
      .em()
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" in (?, ?) and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
        TEST_CUSTOMER_RFQ_ID,
      ]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * Constitution XI, measured where the tenant filter is not what answers.
   * Inside a buyer's own request `QuoteRequest` is filtered to their
   * Organization, so a foreign request is simply not found and the explicit
   * comparison in `judgeQuoteRequestSource` is never reached. A placement in a
   * system scope sees every request; there the comparison is the only thing
   * between a basket's claim and an Order naming another tenant's document.
   */
  describe('a placement that runs wider than one Organization', () => {
    const placeInSystemScope = () =>
      whenOrderCreatedSettled(h, () =>
        enterSystemScope('test: a placement in a system scope', () =>
          (h.container.cradle as unknown as { orderPlacementPort: OrderPlacementPort }).orderPlacementPort.placeOrder(
            { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
            PLACEMENT,
          ),
        ),
      );

    it('the control: its own request is found and named', async () => {
      const own = await acceptedQuoteRequest(h, { quantity: 2, agreedUnitPrice: 11.25 });
      await convert(own.id, ORG_ADMIN);
      const placed = await placeInSystemScope();
      await reactorIdle();
      expect((await orderRow(placed.id)).sourceQuoteRequestId).toBe(own.id);
    });

    it('a request of another Organization is found, and refused: nothing is named and that request is untouched', async () => {
      const foreign = await acceptedQuoteRequest(h, { quantity: 2, agreedUnitPrice: 11.25 }, OTHER_ORG_CUSTOMER);
      // Line for line and price for price what the foreign request holds, so
      // only the Organization tells the two apart.
      const own = await acceptedQuoteRequest(h, { quantity: 2, agreedUnitPrice: 11.25 });
      await convert(own.id, ORG_ADMIN);
      await forgeBasketSource(TEST_CUSTOMER_ID, foreign.id);

      const placed = await placeInSystemScope();
      await reactorIdle();

      const order = await orderRow(placed.id);
      expect(order.organizationId).toBe(TEST_ORGANIZATION_ID);
      expect(order.sourceQuoteRequestId ?? null).toBeNull();
      const untouched = await quoteRow(foreign.id);
      expect(untouched.status).toBe('Approved');
      expect(untouched.convertedOrderId ?? null).toBeNull();
    });
  });

  describe('a basket that was never empty', () => {
    it('the agreed line taken out and the same product put back from the price list: names nothing', async () => {
      const rfq = await acceptedQuoteRequest(h, { quantity: 4, agreedUnitPrice: 11.25 });
      await convert(rfq.id, ORG_ADMIN);
      const add = (productId: string, quantity: number) =>
        h.app.inject({ method: 'POST', url: '/api/v1/cart/items', cookies: ORG_ADMIN, payload: { productId, quantity } });
      expect((await add(SEED_PRODUCT_102_ID, 1)).statusCode).toBe(200);
      const basket = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: ORG_ADMIN });
      const agreed = (basket.json() as { data: { items: Array<{ id: string; productId: string }> } }).data.items.find(
        (item) => item.productId === SEED_PRODUCT_101_ID,
      );
      const removed = await h.app.inject({ method: 'DELETE', url: `/api/v1/cart/items/${agreed?.id}`, cookies: ORG_ADMIN });
      expect(removed.statusCode, removed.body).toBeLessThan(300);
      expect((await add(SEED_PRODUCT_101_ID, 4)).statusCode).toBe(200);

      const placed = await whenOrderCreatedSettled(h, () => checkOut(ORG_ADMIN));
      await reactorIdle();

      const lines = await h.em().find(OrderItem, { orderId: placed }, { filters: false });
      const line = lines.find((candidate) => candidate.productId === SEED_PRODUCT_101_ID);
      // The list price, not the agreed one: nothing of the request is on the Order.
      expect(Number(line?.unitPrice)).not.toBe(11.25);
      expect((await orderRow(placed)).sourceQuoteRequestId ?? null).toBeNull();
      expect((await quoteRow(rfq.id)).status).toBe('Approved');
    });

    it('a second request converted into the same basket: the Order names the second and the first stays open', async () => {
      const first = await acceptedQuoteRequest(h, { quantity: 4, agreedUnitPrice: 11.25 });
      const second = await acceptedQuoteRequest(h, { quantity: 6, agreedUnitPrice: 9.5 });
      await convert(first.id, ORG_ADMIN);
      await convert(second.id, ORG_ADMIN);

      const placed = await whenOrderCreatedSettled(h, () => checkOut(ORG_ADMIN));
      await reactorIdle();

      expect((await orderRow(placed)).sourceQuoteRequestId).toBe(second.id);
      const lines = await h.em().find(OrderItem, { orderId: placed }, { filters: false });
      expect(lines).toHaveLength(1);
      expect(Number(lines[0]?.unitPrice)).toBe(9.5);
      expect(lines[0]?.quantity).toBe(6);
      await expect.poll(async () => (await quoteRow(second.id)).status, { timeout: 10_000 }).toBe('Completed');
      expect((await quoteRow(first.id)).status).toBe('Approved');
    });
  });
});
