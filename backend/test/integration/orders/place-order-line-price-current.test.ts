import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, unitPriceHalfUp } from '@endora-commerce/contracts';

import { Cart, CartItem, Order, OrderItem } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  createTieredProduct,
  TIER_UNIT_PRICE,
  TIER_VOLUME_PRICE,
} from '../../helpers/tiered-product-fixture.js';
import { emptyCustomerBasket } from '../../helpers/customer-basket.js';
import { acceptedQuoteRequest, whenOrderCreatedSettled } from '../../helpers/quote-conversion.js';

/**
 * An order line is placed at the price its cart line may be ordered at **now**,
 * for its current quantity — never at a price the line held at another
 * quantity. A placement whose cart still holds such a price is refused with
 * `409 CART_PRICE_CHANGED`, the cart is brought up to date, and placing again
 * succeeds at the current price.
 */
describe('POST /api/v1/orders — the line price is the price for its current quantity', () => {
  let h: BackendServerHandle;
  let productId: string;
  const customer = { b2b_session: 'stub-customer-session' };
  /** The basket of the system-default channel — the one `place()` (no channel named) uses. */
  let customerCtx: { customerAccountId: string; organizationId: string; salesChannelId: string };

  beforeAll(async () => {
    h = await setupBackendServer();
    productId = await createTieredProduct(h, `order-${Date.now()}`);
    customerCtx = {
      customerAccountId: TEST_CUSTOMER_ID,
      organizationId: TEST_ORGANIZATION_ID,
      salesChannelId: await systemDefaultSalesChannelId(h.em()),
    };
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await emptyCustomerBasket(h, customerCtx);
  });

  function place() {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      cookies: customer,
      headers: { 'content-type': 'application/json' },
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    });
  }

  /**
   * A quote of the test Organization for the agreed line — 10 of the tiered
   * product at 5.00 — accepted and valid for another week. Placement checks
   * that the quote a line is priced at still binds (#167), so an agreed line
   * has to rest on a quote that exists and is in force, not on a made-up id.
   */
  async function inForceQuote(): Promise<string> {
    const rfq = await acceptedQuoteRequest(h, { productId, quantity: 10, agreedUnitPrice: 5 });
    await h
      .em()
      .getConnection()
      .execute(`update "quote_requests" set "expires_at" = now() + interval '7 days' where "id" = ?`, [rfq.id]);
    return rfq.id;
  }

  async function orderLine(orderId: string): Promise<{ quantity: number; unitPrice: string }> {
    const em = h.em();
    em.clear();
    const [line] = await em.find(OrderItem, { orderId });
    return { quantity: line!.quantity, unitPrice: Number(line!.unitPrice).toFixed(2) };
  }

  async function activeCartLine(): Promise<{ id: string; unitPrice: string }> {
    const em = h.em();
    em.clear();
    const cart = await em.findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' });
    const [line] = await em.find(CartItem, { cartId: cart.id });
    return line!;
  }

  it('places a line moved out of the volume bracket at the price for its new quantity', async () => {
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: customer,
      payload: { productId, quantity: 100 },
    });
    expect(added.statusCode).toBe(200);
    const itemId = (added.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemId}`,
      cookies: customer,
      payload: { quantity: 1 },
    });
    expect(patched.statusCode).toBe(200);

    const res = await place();
    expect(res.statusCode, res.body).toBe(201);
    const orderId = (res.json() as { data: { id: string } }).data.id;
    expect(await orderLine(orderId)).toEqual({ quantity: 1, unitPrice: TIER_UNIT_PRICE });
  });

  it('refuses a stored price that is not current, brings the cart up to date, and places at the current price', async () => {
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: customer,
      payload: { productId, quantity: 1 },
    });
    expect(added.statusCode).toBe(200);
    // A line still holding the volume price at one piece — what a cart written
    // before quantity changes were repriced holds, and what a list price change
    // after the line was added leaves behind.
    const stale = await activeCartLine();
    await h.em().nativeUpdate(CartItem, { id: stale.id }, { unitPrice: TIER_VOLUME_PRICE });
    const ordersBefore = await h.em().count(Order, { organizationId: TEST_ORGANIZATION_ID });

    const refused = await place();
    expect(refused.statusCode).toBe(409);
    const error = (refused.json() as {
      error: { code: string; details: { lines: Array<Record<string, unknown>> } };
    }).error;
    expect(error.code).toBe(ERROR_CODES.CART_PRICE_CHANGED);
    expect(error.details.lines).toEqual([
      {
        productId,
        variantId: null,
        quantity: 1,
        // Unit prices at four places (owner ruling of 2026-10-25).
        previousUnitPrice: unitPriceHalfUp(TIER_VOLUME_PRICE),
        currentUnitPrice: unitPriceHalfUp(TIER_UNIT_PRICE),
        currency: 'PLN',
      },
    ]);
    expect(await h.em().count(Order, { organizationId: TEST_ORGANIZATION_ID })).toBe(ordersBefore);

    // The basket the buyer goes back to holds the current price.
    const refreshed = await activeCartLine();
    expect(Number(refreshed.unitPrice).toFixed(2)).toBe(TIER_UNIT_PRICE);

    const placed = await place();
    expect(placed.statusCode, placed.body).toBe(201);
    const orderId = (placed.json() as { data: { id: string } }).data.id;
    expect(await orderLine(orderId)).toEqual({ quantity: 1, unitPrice: TIER_UNIT_PRICE });
  });

  it('places an agreed line at its agreed price while it holds the agreed quantity', async () => {
    await cartWritePortOf(h).replaceItemsForCustomer(
      customerCtx,
      [{ productId, quantity: 10, unitPrice: '5.00', currency: 'PLN' }],
      { sourceQuoteRequestId: await inForceQuote() },
    );

    const res = await whenOrderCreatedSettled(h, () => place());
    expect(res.statusCode, res.body).toBe(201);
    const orderId = (res.json() as { data: { id: string } }).data.id;
    expect(await orderLine(orderId)).toEqual({ quantity: 10, unitPrice: '5.00' });
  });

  it('places an agreed line moved off its agreed quantity at the list price', async () => {
    const seeded = await cartWritePortOf(h).replaceItemsForCustomer(
      customerCtx,
      [{ productId, quantity: 10, unitPrice: '5.00', currency: 'PLN' }],
      { sourceQuoteRequestId: await inForceQuote() },
    );
    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${seeded.items[0]!.id}`,
      cookies: customer,
      payload: { quantity: 12 },
    });
    expect(patched.statusCode).toBe(200);

    const res = await place();
    expect(res.statusCode, res.body).toBe(201);
    const orderId = (res.json() as { data: { id: string } }).data.id;
    expect(await orderLine(orderId)).toEqual({ quantity: 12, unitPrice: TIER_UNIT_PRICE });
  });
});
