import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type OrderPlacementPort } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { acceptedQuoteRequest, convertQuoteRequestToCart } from '../../helpers/quote-conversion.js';
import { Cart, CartItem } from '../../helpers/package-entities.js';

/**
 * Issue #169 (owner ruling) — none of the three paths that place an order on
 * the customer's behalf may touch the customer's active basket:
 *
 *  - admin order creation (`POST /api/v1/admin/orders`),
 *  - one-click buy (`POST /api/v1/quick-order/one-click`),
 *  - the external order intake (`POST /api/v1/external/orders`).
 *
 * Each used to empty the active basket, write the request's lines into it and
 * place it — closing a basket the buyer had built, a quote-seeded one at the
 * agreed prices included, and leaving it `completed` with no order. They now
 * write a **working** basket beside it and place from that one, through the
 * same `placeOrder`.
 *
 * Every case starts from a basket seeded from an accepted Quote Request — the
 * case the issue names as the costliest — and asserts three things: the active
 * basket is the same row with the same lines and source after the order, the
 * order holds what the request named, and the basket the order was placed from
 * is `completed` against that order rather than an orphan. A refused placement
 * leaves the active basket as it was and no working basket behind.
 */

const CUSTOMER_COOKIE = { b2b_session: 'stub-customer-session' };
const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const ONE_CLICK_ENABLED = 'quick_order.one_click_buy_enabled';

interface BasketSnapshot {
  id: string;
  status: string;
  sourceQuoteRequestId: string | null;
  completedOrderId: string | null;
  lines: string[];
}

describe('order placement on the customer’s behalf keeps the active basket (#169)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let apiToken: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    channelId = channel.id;

    await h.settings.adminService.setValueForSubset(ONE_CLICK_ENABLED, [channel.code], true, null, {
      actorAdminUserId: null,
    });
    await h.settings.cache.invalidate(ONE_CLICK_ENABLED);
    const preferences = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/quick-order/preferences',
      cookies: CUSTOMER_COOKIE,
      payload: {
        scope: 'customer',
        scopeId: TEST_CUSTOMER_ID,
        defaultPaymentMethodId: SEED_PAYMENT_METHOD_ID,
        defaultDeliveryMethodId: SEED_DELIVERY_METHOD_ID,
        defaultBillingAddressId: SEED_ADDRESS_BILLING_ID,
        defaultShippingAddressId: SEED_ADDRESS_DELIVERY_ID,
      },
    });
    expect(preferences.statusCode, preferences.body).toBe(200);

    // The intake key is bound to the customer whose basket is under test, on
    // the channel that basket is of.
    const minted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      cookies: ADMIN_COOKIE,
      payload: {
        name: 'Working basket intake key',
        scopes: ['orders:read', 'orders:write'],
        binding: { organizationId: TEST_ORGANIZATION_ID, salesChannelId: channelId, customerAccountId: TEST_CUSTOMER_ID },
      },
    });
    expect(minted.statusCode, minted.body).toBe(201);
    apiToken = (minted.json() as { data: { bearerToken: string } }).data.bearerToken;
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function cartsOf(where: string, params: unknown[]): Promise<BasketSnapshot[]> {
    const conn = h.em().getConnection();
    const carts = await conn.execute<
      Array<{ id: string; status: string; source_quote_request_id: string | null; completed_order_id: string | null }>
    >(
      `select id, status, source_quote_request_id, completed_order_id from carts
        where customer_account_id = ? and ${where} order by created_at`,
      [TEST_CUSTOMER_ID, ...params],
    );
    const out: BasketSnapshot[] = [];
    for (const cart of carts) {
      const lines = await conn.execute<
        Array<{ product_id: string; quantity: number; unit_price: string; agreed_unit_price: string | null }>
      >(`select product_id, quantity, unit_price, agreed_unit_price from cart_items where cart_id = ?`, [cart.id]);
      out.push({
        id: cart.id,
        status: cart.status,
        sourceQuoteRequestId: cart.source_quote_request_id,
        completedOrderId: cart.completed_order_id,
        lines: lines
          .map((l) => `${l.product_id}:${l.quantity}@${l.unit_price}/${l.agreed_unit_price ?? '-'}`)
          .sort(),
      });
    }
    return out;
  }

  /** The customer's active basket on the order's channel — exactly one. */
  async function activeBasket(): Promise<BasketSnapshot> {
    const rows = await cartsOf(`status = 'active' and sales_channel_id = ?`, [channelId]);
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  /** A basket seeded from an accepted Quote Request, at the agreed price. */
  async function quoteSeededBasket(): Promise<BasketSnapshot> {
    const quote = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 });
    const cartId = await convertQuoteRequestToCart(h, quote.id);
    const basket = await activeBasket();
    expect(basket.id).toBe(cartId);
    expect(basket.sourceQuoteRequestId).toBe(quote.id);
    expect(basket.lines).toEqual([`${SEED_PRODUCT_101_ID}:7@11.2500/11.2500`]);
    return basket;
  }

  async function orderItems(orderId: string): Promise<string[]> {
    const rows = await h
      .em()
      .getConnection()
      .execute<Array<{ product_id: string; quantity: number }>>(
        `select product_id, quantity from order_items where order_id = ?`,
        [orderId],
      );
    return rows.map((r) => `${r.product_id}:${r.quantity}`).sort();
  }

  /** The basket the order was placed from: completed against it, emptied, not the active one. */
  async function expectPlacedFromItsOwnBasket(orderId: string, active: BasketSnapshot): Promise<void> {
    const placedFrom = await cartsOf(`completed_order_id = ?`, [orderId]);
    expect(placedFrom).toHaveLength(1);
    expect(placedFrom[0]!.id).not.toBe(active.id);
    expect(placedFrom[0]).toMatchObject({ status: 'completed', completedOrderId: orderId, lines: [] });
    expect(await cartsOf(`status = 'working'`, [])).toEqual([]);
  }

  const adminCreate = (quantity: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      cookies: ADMIN_COOKIE,
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: channelId,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity }],
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
      },
    });

  const oneClick = (quantity: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/one-click',
      cookies: CUSTOMER_COOKIE,
      payload: { productId: SEED_PRODUCT_101_ID, quantity },
    });

  const intake = (quantity: number) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/external/orders',
      headers: { authorization: `Bearer ${apiToken}`, 'idempotency-key': `wb-${randomUUID()}` },
      payload: {
        lines: [{ sku: 'EXAMPLE-SIMPLE-001', quantity }],
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
      },
    });

  const orderIdOf = (body: unknown, path: 'data' | 'data.order'): string => {
    const data = (body as { data: { id: string; order?: { id: string } } }).data;
    return path === 'data' ? data.id : data.order!.id;
  };

  const paths = [
    { name: 'admin order creation', place: adminCreate, idAt: 'data' as const },
    { name: 'one-click buy', place: oneClick, idAt: 'data.order' as const },
    { name: 'external order intake', place: intake, idAt: 'data' as const },
  ];

  /** Lapse the quote the active basket was seeded from (issue #167). */
  const lapseQuoteOf = (basket: BasketSnapshot) =>
    h
      .em()
      .getConnection()
      .execute(`update "quote_requests" set "expires_at" = now() - interval '1 minute' where "id" = ?`, [
        basket.sourceQuoteRequestId,
      ]);

  for (const path of paths) {
    describe(path.name, () => {
      // Issue #167 — the quote-commitment check reads the basket placement
      // reads. A working basket is written from the request's lines with no
      // agreement, so a lapsed quote on the active basket beside it does not
      // refuse the request, and the request is not priced at the quote either.
      it('the active basket’s quote has lapsed: the request still places from its own basket, at no quote price', async () => {
        const before = await quoteSeededBasket();
        await lapseQuoteOf(before);

        // The agreed quantity, so only the missing agreement keeps the quote price off it.
        const res = await path.place(7);
        expect(res.statusCode, res.body).toBe(201);
        const orderId = orderIdOf(res.json(), path.idAt);
        const prices = await h
          .em()
          .getConnection()
          .execute<Array<{ unit_price: string }>>(`select unit_price from order_items where order_id = ?`, [orderId]);
        expect(prices.map((row) => Number(row.unit_price))).not.toContain(11.25);

        expect(await activeBasket()).toEqual(before);
        await expectPlacedFromItsOwnBasket(orderId, before);
      });

      it('places the order and leaves the quote-seeded active basket exactly as it was', async () => {
        const before = await quoteSeededBasket();

        const res = await path.place(2);
        expect(res.statusCode, res.body).toBe(201);
        const orderId = orderIdOf(res.json(), path.idAt);

        expect(await orderItems(orderId)).toEqual([`${SEED_PRODUCT_101_ID}:2`]);
        expect(await activeBasket()).toEqual(before);
        await expectPlacedFromItsOwnBasket(orderId, before);
      });

      it('a placement refused after the lines were written leaves the active basket as it was and no working basket', async () => {
        const before = await quoteSeededBasket();

        // More than the stock holds: refused by `placeOrder`, after the
        // request's lines are already in a basket.
        const res = await path.place(100000);
        expect(res.statusCode, res.body).toBe(409);
        expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.STOCK_UNAVAILABLE);

        expect(await activeBasket()).toEqual(before);
        expect(await cartsOf(`status = 'working'`, [])).toEqual([]);
      });
    });
  }

  /**
   * Issue #167 — no path writes an agreement into a working basket today (the
   * quote seed writes the active one only), so this forges one, to hold that
   * the check is not a property of which basket placement reads.
   */
  it('a working basket carrying a lapsed quote’s agreed line is refused like the active one, and removed', async () => {
    const before = await quoteSeededBasket();
    await lapseQuoteOf(before);
    const em = h.em().fork();
    const working = em.create(Cart, {
      customerAccountId: TEST_CUSTOMER_ID,
      organizationId: TEST_ORGANIZATION_ID,
      salesChannelId: channelId,
      status: 'working',
    });
    await em.flush();
    em.create(CartItem, {
      cartId: working.id,
      productId: SEED_PRODUCT_101_ID,
      quantity: 7,
      unitPrice: '11.2500',
      currency: 'PLN',
      priceSource: 'agreed',
      agreedQuantity: 7,
      agreedUnitPrice: '11.2500',
      agreedCurrency: 'PLN',
      quoteRequestId: before.sourceQuoteRequestId,
    });
    await em.flush();

    const placement = (h.container.cradle as unknown as { orderPlacementPort: OrderPlacementPort }).orderPlacementPort;
    await expect(
      placement.placeOrder(
        { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
        {
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
          salesChannelId: channelId,
        },
        { workingBasketId: working.id },
      ),
    ).rejects.toMatchObject({ statusCode: 410, code: ERROR_CODES.QUOTE_VALIDITY_ENDED, details: { code: 'lapsed' } });

    expect(await activeBasket()).toEqual(before);
    expect(await cartsOf(`status = 'working'`, [])).toEqual([]);
  });
});
