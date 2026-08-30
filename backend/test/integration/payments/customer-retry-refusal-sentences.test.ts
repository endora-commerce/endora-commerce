import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paymentsErrorCodes } from '@endora-commerce/mod-payments';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  Order,
  Payment,
  PaymentMethod,
  type PaymentMethodRow,
} from '../../helpers/package-entities.js';

/**
 * The buyer's payment-retry refusals answer their own codes, in the buyer's
 * language (issue #264's surface; feature 085's Phase F/G pair).
 *
 * All three refusals wore `409 VALIDATION_FAILED` with a prose sentence, which
 * is the one code `localizeErrorEnvelope` returns **before** translating
 * (`packages/platform/src/http/error-envelope.ts`, and rightly — the code is
 * overloaded and several services carry machine-readable tokens in its
 * message). So a domain refusal wearing it is untranslatable by construction,
 * and a Polish buyer trying to pay a declined order read the raise site's
 * English whatever language they asked for.
 *
 * **Why an exact Polish sentence and not a `not.toBe(english)`.** The
 * degradation *is* English: when the code is one the envelope declines to
 * translate, or the routing answer stops reaching a bundle, the buyer is served
 * the raise site's own English prose — a perfectly plausible-looking answer
 * that no English-only assertion can distinguish from a working translation.
 * Measured on the previous code with the *correct English sentence* at each
 * raise site and only the locale under test: `accept-language: pl` still
 * produced `This order is not awaiting payment.` That is what makes the message
 * the wrong place to look and the code the right one. Same reasoning as
 * `test/integration/_i18n/platform-error-sentences.test.ts` and the order
 * cancellation route this is the retry twin of.
 *
 * The sentences are written out rather than read from
 * `packages/modules/payments/i18n/*.json`: a test that loads the file it is
 * checking asserts only that JSON parses.
 */
const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };

const PL = {
  notDue: 'To zamówienie nie oczekuje na płatność.',
  closed: 'To zamówienie zostało zamknięte i nie można go już opłacić.',
  adapter: 'Metoda płatności wybrana przy składaniu tego zamówienia nie jest już dostępna.',
} as const;

const EN = {
  notDue: 'This order is not awaiting payment.',
  closed: 'This order is closed and can no longer be paid.',
  adapter: 'The payment method this order was placed with is no longer available.',
} as const;

describe('a buyer is refused a payment retry in their own language', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Earlier files in this suite place orders against the same product; top
    // its default-warehouse stock up rather than assume it. Scoped to the one
    // product, so nothing else in the table moves.
    await h
      .em()
      .execute(`update "stock_levels" set "on_hand" = 1000 where "product_id" = ?`, [
        SEED_PRODUCT_101_ID,
      ]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** A payment method of this file's own, so no other file's fixture moves. */
  async function bankTransferMethod(): Promise<PaymentMethodRow> {
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `pr_${randomUUID().slice(0, 8)}`,
      name: { default: 'Payment retry refusals' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'on_hold',
    });
    await em.persistAndFlush(method);
    return method;
  }

  /** Places a one-line order as the stub buyer. */
  async function place(): Promise<string> {
    const method = await bankTransferMethod();
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      ...BUYER,
    });
    expect(add.statusCode).toBe(200);

    const placed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: method.id,
      },
      ...BUYER,
    });
    expect(placed.statusCode).toBe(201);
    return (placed.json() as { data: { id: string } }).data.id;
  }

  /**
   * The refusal as the buyer's client actually receives it — the code it
   * branches on and the sentence it shows. Asserting the status alone is what
   * let all three of these answer `VALIDATION_FAILED` unnoticed.
   */
  async function refusal(orderId: string, language: string) {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/payments/retry`,
      headers: { 'accept-language': language },
      ...BUYER,
    });
    return {
      statusCode: res.statusCode,
      ...(res.json() as { error: { code: string; message: string } }).error,
    };
  }

  /** The money term: a credit-limit draw is unpaid by arrangement, not by the buyer. */
  async function orderSettledByArrangement(): Promise<string> {
    const orderId = await place();
    const em = h.em();
    const order = await em.findOneOrFail(Order, { id: orderId });
    order.paymentStatus = 'deferred';
    await em.flush();
    return orderId;
  }

  /** The lifecycle term: the buyer cancelled it themselves, one control over. */
  async function cancelledOrder(): Promise<string> {
    const orderId = await place();
    const cancelled = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/cancel`,
      ...BUYER,
    });
    expect(cancelled.statusCode).toBe(200);
    return orderId;
  }

  /**
   * The adapter term: the gateway module that registered it is gone, and the
   * order is in the state this endpoint exists for — a declined first attempt.
   *
   * The decline matters to the fixture as well as to the story: placement
   * leaves an `awaiting_payment` attempt, which `openRetry` resumes rather than
   * replaces, so the refusal below sits behind a `200` until the first attempt
   * has actually failed.
   */
  async function orderWhoseAdapterIsGone(): Promise<string> {
    const orderId = await place();
    const em = h.em();
    const order = await em.findOneOrFail(Order, { id: orderId });
    order.paymentMethodSnapshot = {
      ...order.paymentMethodSnapshot,
      adapter: 'a_gateway_this_shop_no_longer_installs',
    };
    order.paymentStatus = 'failed';
    const attempt = await em.findOneOrFail(
      Payment,
      { orderId },
      { orderBy: { attemptNo: 'desc' } },
    );
    attempt.status = 'failed';
    await em.flush();
    return orderId;
  }

  describe('the money is not the buyer’s to pay', () => {
    it('answers PAYMENT_NOT_DUE, in Polish for a buyer who asked for Polish', async () => {
      const refused = await refusal(await orderSettledByArrangement(), 'pl');

      expect(refused.statusCode).toBe(409);
      expect(refused.code).toBe(paymentsErrorCodes.PAYMENT_NOT_DUE);
      expect(refused.message).toBe(PL.notDue);
      // Said explicitly: the English is what this regresses to, and it is a
      // plausible-looking answer rather than an empty one.
      expect(refused.message).not.toBe(EN.notDue);
    });

    it('and English is still English — the assertion above is about the language, not the sentence', async () => {
      const refused = await refusal(await orderSettledByArrangement(), 'en');

      expect(refused.statusCode).toBe(409);
      expect(refused.code).toBe(paymentsErrorCodes.PAYMENT_NOT_DUE);
      expect(refused.message).toBe(EN.notDue);
    });
  });

  describe('the order is over', () => {
    it('answers PAYMENT_ORDER_CLOSED, in Polish for a buyer who asked for Polish', async () => {
      const refused = await refusal(await cancelledOrder(), 'pl');

      expect(refused.statusCode).toBe(409);
      expect(refused.code).toBe(paymentsErrorCodes.PAYMENT_ORDER_CLOSED);
      expect(refused.message).toBe(PL.closed);
      expect(refused.message).not.toBe(EN.closed);
      // And not the other refusal's sentence either: a cancelled order is still
      // unpaid, so a single code over both terms would say the wrong thing here.
      expect(refused.message).not.toBe(PL.notDue);
    });

    it('and English is still English', async () => {
      const refused = await refusal(await cancelledOrder(), 'en');

      expect(refused.statusCode).toBe(409);
      expect(refused.code).toBe(paymentsErrorCodes.PAYMENT_ORDER_CLOSED);
      expect(refused.message).toBe(EN.closed);
    });
  });

  describe('the shop can no longer start a session for the method', () => {
    it('answers PAYMENT_ADAPTER_UNAVAILABLE, in Polish for a buyer who asked for Polish', async () => {
      const refused = await refusal(await orderWhoseAdapterIsGone(), 'pl');

      expect(refused.statusCode).toBe(409);
      expect(refused.code).toBe(paymentsErrorCodes.PAYMENT_ADAPTER_UNAVAILABLE);
      expect(refused.message).toBe(PL.adapter);
      expect(refused.message).not.toBe(EN.adapter);
    });

    it('and English is still English', async () => {
      const refused = await refusal(await orderWhoseAdapterIsGone(), 'en');

      expect(refused.statusCode).toBe(409);
      expect(refused.code).toBe(paymentsErrorCodes.PAYMENT_ADAPTER_UNAVAILABLE);
      expect(refused.message).toBe(EN.adapter);
    });
  });
});
