import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { Cart, CartItem, OrderItem, QuoteRequest } from '../../helpers/package-entities.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import {
  acceptedQuoteRequest,
  convertQuoteRequestToCart,
  whenOrderCreatedSettled,
} from '../../helpers/quote-conversion.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(
    readFileSync(new URL(`../../../../packages/modules/quote_requests/i18n/${language}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;
const EN = bundle('en');
const PL = bundle('pl');

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const PLACEMENT = {
  deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
  billingAddressId: SEED_ADDRESS_BILLING_ID,
  deliveryMethodId: SEED_DELIVERY_METHOD_ID,
  paymentMethodId: SEED_PAYMENT_METHOD_ID,
};

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/**
 * Issue #167 — a quote's validity date binds **order placement**, not only the
 * seeding of the basket (owner ruling of 2026-11-02: a basket seeded from a
 * quote that has since expired cannot be ordered; a new quote must be issued).
 *
 * Every case walks the buyer's road — a quote priced, accepted and converted
 * into the basket — and then moves the quote by hand, the way time or an
 * operator would, between the conversion and the checkout.
 */
describe('orders — a quote’s validity is checked again when the order is placed (#167)', () => {
  let h: BackendServerHandle;

  const place = (language: 'en' | 'pl' = 'en') =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      cookies: CUSTOMER,
      headers: { 'accept-language': language },
      payload: PLACEMENT,
    });

  const preview = async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      cookies: CUSTOMER,
      payload: { deliveryMethodId: SEED_DELIVERY_METHOD_ID, paymentMethodId: SEED_PAYMENT_METHOD_ID },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { quoteCommitmentRefusal: string | null } }).data;
  };

  const setQuote = (quoteRequestId: string, assignments: string) =>
    h.em().getConnection().execute(`update "quote_requests" set ${assignments} where "id" = ?`, [quoteRequestId]);

  const basketLines = async () => {
    const em = h.em();
    em.clear();
    const cart = await em.findOneOrFail(
      Cart,
      { customerAccountId: TEST_CUSTOMER_ID, status: 'active' },
      { filters: false },
    );
    return em.find(CartItem, { cartId: cart.id }, { filters: false });
  };

  const quoteStatus = async (quoteRequestId: string) => {
    const em = h.em();
    em.clear();
    return (await em.findOneOrFail(QuoteRequest, { id: quoteRequestId }, { filters: false })).status;
  };

  /** A quote valid for another week, converted into the buyer's basket. */
  const seededBasket = async () => {
    const rfq = await acceptedQuoteRequest(h, { quantity: 7, agreedUnitPrice: 11.25 });
    await setQuote(rfq.id, `"expires_at" = now() + interval '7 days'`);
    await convertQuoteRequestToCart(h, rfq.id);
    return rfq;
  };

  const expectRefused = async (reason: 'lapsed' | 'withdrawn' | 'unavailable') => {
    const res = await place();
    expect(res.statusCode, res.body).toBe(410);
    expect((res.json() as ErrorBody).error).toMatchObject({
      code: ERROR_CODES.QUOTE_VALIDITY_ENDED,
      message: EN[`errors.QUOTE_VALIDITY_ENDED.${reason}`],
      details: { code: reason },
    });
  };

  /** The stock this file tops up, put back in `afterAll`: the database is shared by every file. */
  let savedStock: Array<{ id: string; on_hand: number }> = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const connection = h.em().getConnection();
    savedStock = await connection.execute(`select "id", "on_hand" from "stock_levels" where "product_id" = ?`, [
      SEED_PRODUCT_101_ID,
    ]);
    await connection.execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [
      SEED_PRODUCT_101_ID,
    ]);
  });

  beforeEach(async () => {
    await h
      .em()
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);
  });

  afterAll(async () => {
    const connection = h.em().getConnection();
    for (const row of savedStock) {
      await connection.execute(`update "stock_levels" set "on_hand" = ? where "id" = ?`, [row.on_hand, row.id]);
    }
    await teardownBackendServer(h);
  });

  it('the seeded line names the quote its agreed price came from', async () => {
    const rfq = await seededBasket();
    const lines = await basketLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quoteRequestId).toBe(rfq.id);
  });

  it('inside the validity window: the order is placed at the agreed price', async () => {
    await seededBasket();
    expect((await preview()).quoteCommitmentRefusal).toBeNull();
    const res = await whenOrderCreatedSettled(h, () => place());
    expect(res.statusCode, res.body).toBe(201);
    const orderId = (res.json() as { data: { id: string } }).data.id;
    const lines = await h.em().find(OrderItem, { orderId }, { filters: false });
    expect(Number(lines[0]?.unitPrice)).toBe(11.25);
  });

  it('the quote lapses after the basket was seeded: the preview says so and placement refuses, basket intact', async () => {
    const rfq = await seededBasket();
    await setQuote(rfq.id, `"expires_at" = now() - interval '1 minute'`);

    expect((await preview()).quoteCommitmentRefusal).toBe('lapsed');
    await expectRefused('lapsed');

    // In the buyer's language.
    const polish = await place('pl');
    expect(polish.statusCode, polish.body).toBe(410);
    expect((polish.json() as ErrorBody).error.message).toBe(PL['errors.QUOTE_VALIDITY_ENDED.lapsed']);

    // Nothing was written: the basket is as the buyer left it and the quote is untouched.
    const lines = await basketLines();
    expect(lines.map((line) => [line.quantity, Number(line.unitPrice)])).toEqual([[7, 11.25]]);
    expect(await quoteStatus(rfq.id)).toBe('Approved');
  });

  it('a lapsed quote’s line moved off its agreed quantity is priced from the list and places', async () => {
    const rfq = await seededBasket();
    await setQuote(rfq.id, `"expires_at" = now() - interval '1 minute'`);
    const [line] = await basketLines();
    const changed = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${line!.id}`,
      cookies: CUSTOMER,
      payload: { quantity: 6 },
    });
    expect(changed.statusCode, changed.body).toBe(200);

    expect((await preview()).quoteCommitmentRefusal).toBeNull();
    const res = await whenOrderCreatedSettled(h, () => place());
    expect(res.statusCode, res.body).toBe(201);
    const orderId = (res.json() as { data: { id: string } }).data.id;
    const lines = await h.em().find(OrderItem, { orderId }, { filters: false });
    expect(Number(lines[0]?.unitPrice)).not.toBe(11.25);
  });

  it('a quote re-opened or cancelled after the basket was seeded: refused as no longer in force', async () => {
    const reopened = await seededBasket();
    await setQuote(reopened.id, `"status" = 'Pending'`);
    expect((await preview()).quoteCommitmentRefusal).toBe('withdrawn');
    await expectRefused('withdrawn');

    const cancelled = await seededBasket();
    await setQuote(cancelled.id, `"status" = 'Canceled', "canceled_at" = now()`);
    await expectRefused('withdrawn');
  });

  describe('with quote_requests off', () => {
    it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
      'while %s, nothing can confirm the agreed prices: refused; back on, the same basket places',
      async (axis) => {
        await seededBasket();
        await withModuleOff('quote_requests', axis, async () => {
          expect((await preview()).quoteCommitmentRefusal).toBe('unavailable');
          await expectRefused('unavailable');
        });
        const res = await whenOrderCreatedSettled(h, () => place());
        expect(res.statusCode, res.body).toBe(201);
      },
    );
  });
});
