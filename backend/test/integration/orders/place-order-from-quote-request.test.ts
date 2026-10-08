import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { Cart, CartItem, Order, OrderItem, QuoteRequest, StockLevel } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import {
  acceptedQuoteRequest,
  checkOutBasket,
  convertQuoteRequestToCart,
  whenOrderCreatedSettled,
} from '../../helpers/quote-conversion.js';

const SALES_CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const OTHER_ORG_CUSTOMER = { b2b_session: 'stub-customer-session-other-org' };
const ADMIN = { b2b_session: 'stub-admin-session' };

/**
 * An Order placed from an accepted Quote Request names that request
 * (`specs/143-crm-sales-opportunities/`, FR-100 … FR-103; research N-QS1).
 *
 * `orders.source_quote_request_id` existed from the foundation schema, three
 * readers depended on it — `quote_requests`' completion, `crm`'s linking and
 * its "counted once" — and no placement wrote it. Every case below walks the
 * road a buyer walks: a request priced by an operator, accepted, converted
 * into a basket, checked out. The only rows written by hand are the forged
 * ones, which is what a forgery is.
 */
describe('orders — an order placed from an accepted quote request', () => {
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

  const basketItems = async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: CUSTOMER });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: { items: Array<{ id: string; productId: string; quantity: number }> } }).data
      .items;
  };

  const basketLineOf = async (productId: string) => {
    const line = (await basketItems()).find((item) => item.productId === productId);
    if (!line) throw new Error(`the basket holds no line of ${productId}`);
    return line;
  };

  const addToBasket = async (productId: string, quantity = 1) => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: CUSTOMER,
      payload: { productId, quantity },
    });
    expect(response.statusCode, response.body).toBe(200);
  };

  const place = () => whenOrderCreatedSettled(h, () => checkOutBasket(h));

  const activeBasket = async () => {
    const em = h.em();
    em.clear();
    return em.findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }, { filters: false });
  };

  /** Point the buyer's active basket at `quoteRequestId` — what no route lets a client do. */
  const forgeBasketSource = async (quoteRequestId: string) => {
    const em = h.em();
    em.clear();
    const cart = await em.findOneOrFail(
      Cart,
      { customerAccountId: TEST_CUSTOMER_ID, status: 'active' },
      { filters: false },
    );
    cart.sourceQuoteRequestId = quoteRequestId;
    await em.flush();
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    // The seed stocks one product; the cases that add a second line need it
    // to be orderable too.
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
    // Every case starts from no active basket: a basket left by one case
    // would hand its mark, or its lines, to the next.
    await h
      .em()
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('carries the request it came from, at the agreed price, and completes that request', async () => {
    const rfq = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 });
    await convertQuoteRequestToCart(h, rfq.id);
    const placed = await place();

    const order = await orderRow(placed.id);
    expect(order.sourceQuoteRequestId).toBe(rfq.id);
    expect(order.organizationId).toBe(TEST_ORGANIZATION_ID);
    const lines = await h.em().find(OrderItem, { orderId: placed.id }, { filters: false });
    expect(lines).toHaveLength(1);
    expect(Number(lines[0]?.unitPrice)).toBe(11.25);

    // The other end of the same fact, kept by `quote_requests` itself.
    await expect.poll(async () => (await quoteRow(rfq.id)).status, { timeout: 10_000 }).toBe('Completed');
    expect((await quoteRow(rfq.id)).convertedOrderId).toBe(placed.id);

    // …and both readers of the Order see it: the buyer's and the operator's.
    const mine = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${placed.id}`, cookies: CUSTOMER });
    expect(mine.statusCode, mine.body).toBe(200);
    expect((mine.json() as { data: { sourceQuoteRequestId: string | null } }).data.sourceQuoteRequestId).toBe(rfq.id);

    // A request that has become an Order cannot become a second one.
    const again = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${rfq.id}/convert-to-order`,
      cookies: CUSTOMER,
      payload: {},
    });
    expect(again.statusCode, again.body).toBe(409);
  });

  it('an order from an ordinary basket names no request — the control', async () => {
    await addToBasket(SEED_PRODUCT_101_ID);
    const placed = await place();
    expect((await orderRow(placed.id)).sourceQuoteRequestId ?? null).toBeNull();
  });

  describe('a basket the buyer changed after the conversion', () => {
    it('keeps its source while an agreed line is still on it — a line added, a quantity changed', async () => {
      const rfq = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 });
      await convertQuoteRequestToCart(h, rfq.id);
      await addToBasket(SEED_PRODUCT_102_ID);
      expect((await activeBasket()).sourceQuoteRequestId).toBe(rfq.id);
      const agreed = await basketLineOf(SEED_PRODUCT_101_ID);
      const changed = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/cart/items/${agreed.id}`,
        cookies: CUSTOMER,
        payload: { quantity: 5 },
      });
      expect(changed.statusCode, changed.body).toBe(200);

      const placed = await place();
      expect((await orderRow(placed.id)).sourceQuoteRequestId).toBe(rfq.id);
      const lines = await h.em().find(OrderItem, { orderId: placed.id }, { filters: false });
      // The agreed price is what survives a changed quantity today; the source
      // follows the same rule.
      expect(Number(lines.find((line) => line.productId === SEED_PRODUCT_101_ID)?.unitPrice)).toBe(11.25);
      await expect.poll(async () => (await quoteRow(rfq.id)).status, { timeout: 10_000 }).toBe('Completed');
    });

    it('loses it once emptied — refilled by hand it is an ordinary order, and the request stays open', async () => {
      const rfq = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 });
      await convertQuoteRequestToCart(h, rfq.id);
      for (const item of await basketItems()) {
        const removed = await h.app.inject({
          method: 'DELETE',
          url: `/api/v1/cart/items/${item.id}`,
          cookies: CUSTOMER,
        });
        expect(removed.statusCode, removed.body).toBeLessThan(300);
      }
      // The basket itself forgets, before placement is asked anything.
      expect((await activeBasket()).sourceQuoteRequestId ?? null).toBeNull();
      await addToBasket(SEED_PRODUCT_101_ID, 7);

      const placed = await place();
      expect((await orderRow(placed.id)).sourceQuoteRequestId ?? null).toBeNull();
      const quote = await quoteRow(rfq.id);
      expect(quote.status).toBe('Approved');
      expect(quote.convertedOrderId ?? null).toBeNull();
    });

    it('loses it when no agreed line is left, even though the basket was never empty', async () => {
      const rfq = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 });
      await convertQuoteRequestToCart(h, rfq.id);
      await addToBasket(SEED_PRODUCT_102_ID);
      const agreed = await basketLineOf(SEED_PRODUCT_101_ID);
      const removed = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/cart/items/${agreed.id}`,
        cookies: CUSTOMER,
      });
      expect(removed.statusCode, removed.body).toBeLessThan(300);

      const placed = await place();
      expect((await orderRow(placed.id)).sourceQuoteRequestId ?? null).toBeNull();
      expect((await quoteRow(rfq.id)).status).toBe('Approved');
    });

    it('loses it when the basket is seeded again without one — what a reorder does', async () => {
      const rfq = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 });
      await convertQuoteRequestToCart(h, rfq.id);
      // The same line at the same price, through the port a reorder uses: only
      // the missing option tells this seed from the conversion's.
      await cartWritePortOf(h).replaceItemsForCustomer(
        { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
        [{ productId: SEED_PRODUCT_101_ID, quantity: 7, unitPrice: '11.25', currency: 'PLN' }],
      );
      const cart = await h
        .em()
        .findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }, { filters: false });
      expect(cart.sourceQuoteRequestId ?? null).toBeNull();

      const placed = await place();
      expect((await orderRow(placed.id)).sourceQuoteRequestId ?? null).toBeNull();
      expect((await quoteRow(rfq.id)).status).toBe('Approved');
    });

    it('loses it when another path closes the basket and fills a new one — an order the operator creates', async () => {
      const rfq = await acceptedQuoteRequest(h);
      await convertQuoteRequestToCart(h, rfq.id);
      const created = await whenOrderCreatedSettled(h, () =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/orders',
          cookies: ADMIN,
          payload: {
            customerAccountId: TEST_CUSTOMER_ID,
            salesChannelId: SALES_CHANNEL_ID,
            items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
            deliveryMethodId: SEED_DELIVERY_METHOD_ID,
            paymentMethodId: SEED_PAYMENT_METHOD_ID,
            deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
            billingAddressId: SEED_ADDRESS_BILLING_ID,
          },
        }),
      );
      expect(created.statusCode, created.body).toBe(201);
      const orderId = (created.json() as { data: { id: string } }).data.id;
      expect((await orderRow(orderId)).sourceQuoteRequestId ?? null).toBeNull();
      expect((await quoteRow(rfq.id)).status).toBe('Approved');
    });
  });

  it('the re-priced copy of a request into the basket is not a conversion and marks nothing', async () => {
    const rfq = await acceptedQuoteRequest(h);
    const copied = await h.app.inject({
      method: 'POST',
      url: `/api/v1/cart/from-quote-request/${rfq.id}`,
      cookies: CUSTOMER,
      payload: {},
    });
    expect(copied.statusCode, copied.body).toBeLessThan(300);
    const cart = await h
      .em()
      .findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }, { filters: false });
    expect(cart.sourceQuoteRequestId ?? null).toBeNull();
    expect(await h.em().count(CartItem, { cartId: cart.id })).toBeGreaterThan(0);
  });

  describe('a source the basket claims and placement does not believe', () => {
    it('a request of another Organization: the order is placed, names nothing, and that request is untouched', async () => {
      const foreign = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 }, OTHER_ORG_CUSTOMER);
      // The buyer's own conversion, so the basket is line-for-line and
      // price-for-price what the foreign request holds as well: only the
      // Organization tells the two apart.
      const own = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 });
      await convertQuoteRequestToCart(h, own.id);
      await forgeBasketSource(foreign.id);

      const placed = await place();
      expect((await orderRow(placed.id)).sourceQuoteRequestId ?? null).toBeNull();
      const untouched = await quoteRow(foreign.id);
      expect(untouched.status).toBe('Approved');
      expect(untouched.convertedOrderId ?? null).toBeNull();
      const body = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${placed.id}`, cookies: CUSTOMER });
      expect(body.body).not.toContain(foreign.id);
    });

    it('a request that does not exist', async () => {
      await addToBasket(SEED_PRODUCT_101_ID);
      await forgeBasketSource(randomUUID());
      const placed = await place();
      expect((await orderRow(placed.id)).sourceQuoteRequestId ?? null).toBeNull();
    });

    it('a request that is no longer approved — cancelled between the conversion and the checkout', async () => {
      const rfq = await acceptedQuoteRequest(h);
      await convertQuoteRequestToCart(h, rfq.id);
      await h
        .em()
        .getConnection()
        .execute(`update "quote_requests" set "status" = 'Canceled', "canceled_at" = now() where "id" = ?`, [rfq.id]);

      const placed = await place();
      expect((await orderRow(placed.id)).sourceQuoteRequestId ?? null).toBeNull();
      const quote = await quoteRow(rfq.id);
      expect(quote.status).toBe('Canceled');
      expect(quote.convertedOrderId ?? null).toBeNull();
    });

    it('a request of the buyer’s own that the basket does not hold a line of', async () => {
      const rfq = await acceptedQuoteRequest(h);
      await addToBasket(SEED_PRODUCT_102_ID);
      await forgeBasketSource(rfq.id);
      const placed = await place();
      expect((await orderRow(placed.id)).sourceQuoteRequestId ?? null).toBeNull();
      expect((await quoteRow(rfq.id)).status).toBe('Approved');
    });
  });

  it('a client cannot name a source: the placement body has no such field and ignores one', async () => {
    const rfq = await acceptedQuoteRequest(h);
    await addToBasket(SEED_PRODUCT_101_ID);
    const placed = await whenOrderCreatedSettled(h, () =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        cookies: CUSTOMER,
        payload: {
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
          sourceQuoteRequestId: rfq.id,
        },
      }),
    );
    // Either answer is a refusal to take the id from the client; what may not
    // happen is an Order naming the request.
    if (placed.statusCode === 201) {
      const orderId = (placed.json() as { data: { id: string } }).data.id;
      expect((await orderRow(orderId)).sourceQuoteRequestId ?? null).toBeNull();
    } else {
      expect(placed.statusCode, placed.body).toBe(400);
    }
    expect((await quoteRow(rfq.id)).status).toBe('Approved');
  });

  describe('with quote_requests off', () => {
    it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
      'a basket converted earlier is still checked out while the module is %s — as an ordinary order',
      async (axis) => {
        const rfq = await acceptedQuoteRequest(h);
        await convertQuoteRequestToCart(h, rfq.id);

        const placed = await withModuleOff('quote_requests', axis, () => place());

        const order = await orderRow(placed.id);
        expect(order.sourceQuoteRequestId ?? null).toBeNull();
        const lines = await h.em().find(OrderItem, { orderId: placed.id }, { filters: false });
        expect(Number(lines[0]?.unitPrice)).toBe(rfq.agreedUnitPrice);
        // Nothing of the switched-off module moved.
        const quote = await quoteRow(rfq.id);
        expect(quote.status).toBe('Approved');
        expect(quote.convertedOrderId ?? null).toBeNull();
      },
    );

    it('and an ordinary basket is checked out exactly as before', async () => {
      await addToBasket(SEED_PRODUCT_101_ID);
      const placed = await withModuleOff('quote_requests', 'deactivated', () => place());
      expect((await orderRow(placed.id)).sourceQuoteRequestId ?? null).toBeNull();
    });
  });
});
