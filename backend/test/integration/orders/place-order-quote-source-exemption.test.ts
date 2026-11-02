import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart, Order, Product } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_CUSTOMER_RFQ_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedOtherTestCustomer } from '../../helpers/seed-organizations.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import { acceptedQuoteRequest, whenOrderCreatedSettled } from '../../helpers/quote-conversion.js';
import { setProductMinimum } from '../../helpers/order-minimum-fixture.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';

/**
 * Feature 155, Phase 8 (T056a) — FR-036, US4 #7e, threat F2: a quote-seeded
 * line is exempt from the minimums at placement only while the basket's quote
 * source is vouched **at that moment** — the request still approved, of the
 * buyer's Organization, not yet the source of an Order, its validity not lapsed,
 * and an agreed line still on the basket.
 *
 * The cart takes the basket's mark at face value (FR-028), so in every refused
 * case below the cart view still shows the line as exempt — the deliberate gap
 * between the cart and the checkout — while the checkout preview flags it and
 * placement refuses it.
 *
 * A is the seeded product 101: every quote is accepted for 101 × 5 before A's
 * minimum of 10 is set (restored in `afterAll`).
 */

/** The Organization's administrator — may convert any request of the Organization. */
const ORG_ADMIN = { b2b_session: 'stub-customer-session' };
/** A regular user of the same Organization, who raises the shared request. */
const COLLEAGUE = { b2b_session: 'stub-customer-session-rfq' };
const OTHER_ORG_CUSTOMER = { b2b_session: 'stub-customer-session-other-org' };
const A = SEED_PRODUCT_101_ID;
const PLACEMENT = {
  deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
  billingAddressId: SEED_ADDRESS_BILLING_ID,
  deliveryMethodId: SEED_DELIVERY_METHOD_ID,
  paymentMethodId: SEED_PAYMENT_METHOD_ID,
};

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

type QuoteKey = 'valid' | 'cancelled' | 'expired' | 'replaced' | 'twoBaskets' | 'concurrent';

describe('155 — the quote-line exemption needs a vouched quote source at placement [integration]', () => {
  let h: BackendServerHandle;
  let previousMinimumOfA: number | null = null;
  const quotes = {} as Record<QuoteKey, string>;
  let foreignQuote = '';

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
  };

  const place = (cookies: Record<string, string>) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      cookies,
      headers: { 'accept-language': 'en' },
      payload: PLACEMENT,
    });

  const previewLines = async (cookies: Record<string, string>) => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      cookies,
      payload: { deliveryMethodId: SEED_DELIVERY_METHOD_ID, paymentMethodId: SEED_PAYMENT_METHOD_ID },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { belowMinimumLines: Array<{ productId: string; kind: string; minimum?: number }> } })
      .data.belowMinimumLines;
  };

  const viewFlagOfA = async (cookies: Record<string, string>) => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { data: { items: Array<{ productId: string; belowMinimum?: unknown }> } }).data.items;
    const line = items.find((i) => i.productId === A);
    if (!line) throw new Error('no line of A on the basket');
    return line.belowMinimum ?? null;
  };

  const orderSource = async (orderId: string) => {
    const em = h.em();
    em.clear();
    return (await em.findOneOrFail(Order, { id: orderId }, { filters: false })).sourceQuoteRequestId ?? null;
  };

  /** The case's verdict: the cart still trusts the mark; the preview and placement do not. */
  const expectJudgedLikeAnyLine = async (cookies: Record<string, string>) => {
    expect(await viewFlagOfA(cookies)).toBeNull();
    expect(await previewLines(cookies)).toEqual([expect.objectContaining({ productId: A, kind: 'pieces', minimum: 10 })]);
    const res = await place(cookies);
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as ErrorBody).error).toMatchObject({
      code: ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY,
      details: { productId: A, minimum: 10 },
    });
  };

  /**
   * Issue #167 — a quote that no longer binds its prices refuses the placement
   * outright, ahead of the minimums. The exemption verdict is unchanged: the
   * preview still flags the line, so a buyer who removes the quote's lines
   * sees what is left to fix.
   */
  const expectQuoteNoLongerBinds = async (cookies: Record<string, string>, reason: 'lapsed' | 'withdrawn') => {
    expect(await viewFlagOfA(cookies)).toBeNull();
    expect(await previewLines(cookies)).toEqual([expect.objectContaining({ productId: A, kind: 'pieces', minimum: 10 })]);
    const res = await place(cookies);
    expect(res.statusCode, res.body).toBe(410);
    expect((res.json() as ErrorBody).error).toMatchObject({
      code: ERROR_CODES.QUOTE_VALIDITY_ENDED,
      details: { code: reason },
    });
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await em.getConnection().execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [A]);
    await seedOtherTestCustomer(em);
    const a = await em.findOneOrFail(Product, { id: A }, { filters: false });
    previousMinimumOfA = a.minOrderQuantity ?? null;
    await setProductMinimum(em, A, null);
    for (const key of ['valid', 'cancelled', 'expired', 'replaced'] as const) {
      quotes[key] = (await acceptedQuoteRequest(h, { quantity: 5, agreedUnitPrice: 11.25 }, ORG_ADMIN)).id;
    }
    for (const key of ['twoBaskets', 'concurrent'] as const) {
      quotes[key] = (await acceptedQuoteRequest(h, { quantity: 5, agreedUnitPrice: 11.25 }, COLLEAGUE)).id;
    }
    foreignQuote = (await acceptedQuoteRequest(h, { quantity: 5, agreedUnitPrice: 11.25 }, OTHER_ORG_CUSTOMER)).id;
    await setProductMinimum(em, A, 10);
  }, 180_000);

  beforeEach(async () => {
    await h
      .em()
      .getConnection()
      .execute(
        `update "carts" set "status" = 'completed' where "customer_account_id" in (?, ?) and "status" = 'active'`,
        [TEST_CUSTOMER_ID, TEST_CUSTOMER_RFQ_ID],
      );
  });

  afterAll(async () => {
    await setProductMinimum(h.em(), A, previousMinimumOfA);
    await teardownBackendServer(h);
  });

  it('places A × 5 while the quote is valid', async () => {
    await convert(quotes.valid, ORG_ADMIN);
    expect(await viewFlagOfA(ORG_ADMIN)).toBeNull();
    expect(await previewLines(ORG_ADMIN)).toEqual([]);
    const res = await whenOrderCreatedSettled(h, () => place(ORG_ADMIN));
    expect(res.statusCode, res.body).toBe(201);
    expect(await orderSource((res.json() as { data: { id: string } }).data.id)).toBe(quotes.valid);
  });

  it('the quote cancelled after the conversion → its prices no longer bind (#167)', async () => {
    await convert(quotes.cancelled, ORG_ADMIN);
    await h
      .em()
      .getConnection()
      .execute(`update "quote_requests" set "status" = 'Canceled', "canceled_at" = now() where "id" = ?`, [
        quotes.cancelled,
      ]);
    await expectQuoteNoLongerBinds(ORG_ADMIN, 'withdrawn');
  });

  it('the quote’s validity lapsed (expires_at in the past, still Approved) → its prices no longer bind (#167)', async () => {
    await convert(quotes.expired, ORG_ADMIN);
    await h
      .em()
      .getConnection()
      .execute(`update "quote_requests" set "expires_at" = now() - interval '1 day' where "id" = ?`, [quotes.expired]);
    await expectQuoteNoLongerBinds(ORG_ADMIN, 'lapsed');
  });

  it('two baskets of one quote — the first places, the second is refused below the minimum', async () => {
    await convert(quotes.twoBaskets, COLLEAGUE);
    await convert(quotes.twoBaskets, ORG_ADMIN);
    const first = await whenOrderCreatedSettled(h, () => place(COLLEAGUE));
    expect(first.statusCode, first.body).toBe(201);
    expect(await orderSource((first.json() as { data: { id: string } }).data.id)).toBe(quotes.twoBaskets);
    // Whatever the request's status reads now, an Order already names it.
    await h
      .em()
      .getConnection()
      .execute(
        `update "quote_requests" set "status" = 'Approved', "completed_at" = null, "converted_order_id" = null where "id" = ?`,
        [quotes.twoBaskets],
      );
    await expectJudgedLikeAnyLine(ORG_ADMIN);
  });

  it('every seeded line replaced by a price-list line of A × 5, the mark kept → judged like any line', async () => {
    await convert(quotes.replaced, ORG_ADMIN);
    // The same product and quantity at the list price: the line still carries a
    // seeded quantity and the basket its mark, but no agreed line is left.
    await cartWritePortOf(h).replaceItemsForCustomer(
      {
        customerAccountId: TEST_CUSTOMER_ID,
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: await systemDefaultSalesChannelId(h.em()),
      },
      [{ productId: A, quantity: 5, unitPrice: '19.99', currency: 'PLN' }],
      { sourceQuoteRequestId: quotes.replaced },
    );
    await expectJudgedLikeAnyLine(ORG_ADMIN);
  });

  it('a quote of another Organization named by the basket → its prices do not bind here (XI, #167)', async () => {
    await cartWritePortOf(h).replaceItemsForCustomer(
      {
        customerAccountId: TEST_CUSTOMER_ID,
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: await systemDefaultSalesChannelId(h.em()),
      },
      [{ productId: A, quantity: 5, unitPrice: '11.25', currency: 'PLN' }],
      { sourceQuoteRequestId: foreignQuote },
    );
    await expectQuoteNoLongerBinds(ORG_ADMIN, 'withdrawn');
  });

  /**
   * Plan I7 — the advisory lock on the request is now taken before the stock row
   * locks. Two placements of one quote at the same moment take turns for the
   * whole placement: both settle (no deadlock), one is the request's Order and
   * the other, finding that Order, is refused below the minimum.
   */
  it('I7 — two placements of one quote at the same moment: one 201, one 422, no deadlock', async () => {
    await convert(quotes.concurrent, COLLEAGUE);
    await convert(quotes.concurrent, ORG_ADMIN);
    const [colleague, admin] = await Promise.all([place(COLLEAGUE), place(ORG_ADMIN)]);
    await reactorIdle();
    const statuses = [colleague.statusCode, admin.statusCode].sort();
    expect(statuses, `${colleague.body}\n${admin.body}`).toEqual([201, 422]);
    const winner = colleague.statusCode === 201 ? colleague : admin;
    const loser = colleague.statusCode === 201 ? admin : colleague;
    expect(await orderSource((winner.json() as { data: { id: string } }).data.id)).toBe(quotes.concurrent);
    expect((loser.json() as ErrorBody).error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
    // The loser's basket is intact and still carries the mark.
    const em = h.em();
    em.clear();
    const loserCustomer = loser === colleague ? TEST_CUSTOMER_RFQ_ID : TEST_CUSTOMER_ID;
    const basket = await em.findOneOrFail(
      Cart,
      { customerAccountId: loserCustomer, status: 'active' },
      { filters: false },
    );
    expect(basket.sourceQuoteRequestId).toBe(quotes.concurrent);
  }, 60_000);
});
