import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCreditLimitRaceFixture } from '../../helpers/seed-credit-limit.js';

/**
 * Issue #86 — `LIMIT_INSUFFICIENT` says the two amounts it is about.
 *
 * The thrower wrote "Available credit limit (500.5) is below order total
 * (999.5)." and put the figures nowhere else, so when the envelope replaced
 * the message with the bundle sentence the buyer was told the limit "does not
 * cover this order" and not by how much. The figures now travel in `details`,
 * and both sentences name them.
 *
 * The fixture grants 1500.00 PLN to one organization with two buyers, each
 * holding a cart of about 1000: the first order fits, the second does not.
 */

interface Refusal {
  error: {
    code: string;
    message: string;
    details?: { availableAmount?: unknown; orderTotal?: unknown; currency?: unknown };
  };
}

const AMOUNT = /^\d+\.\d{2}$/;

describe('LIMIT_INSUFFICIENT carries the amounts and both sentences name them (issue #86)', () => {
  let h: BackendServerHandle;
  /** What the organization may still spend, read from its own credit-limit endpoint. */
  let availableAfterFirstOrder = '';

  function place(cookie: string, acceptLanguage: string) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: '00000000-0000-4000-8000-0000000000f2',
      },
      cookies: { b2b_session: cookie },
      headers: { 'accept-language': acceptLanguage },
    });
  }

  async function refusal(acceptLanguage: string): Promise<Refusal['error']> {
    const res = await place('stub-customer-session-cl-b', acceptLanguage);
    // The status the refusal has always had.
    expect(res.statusCode).toBe(409);
    const body = res.json() as Refusal;
    expect(body.error.code).toBe(ERROR_CODES.LIMIT_INSUFFICIENT);
    return body.error;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCreditLimitRaceFixture(h.em());
    const first = await place('stub-customer-session-cl-a', 'en');
    expect(first.statusCode).toBe(201);
    const limit = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/credit-limit',
      cookies: { b2b_session: 'stub-customer-session-cl-b' },
    });
    expect(limit.statusCode).toBe(200);
    availableAfterFirstOrder = Number(
      (limit.json() as { data: { availableAmount: number } }).data.availableAmount,
    ).toFixed(2);
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('details carry what is left, what the order needs and the currency', async () => {
    const { details } = await refusal('en');
    expect(details).toEqual({
      availableAmount: availableAfterFirstOrder,
      orderTotal: expect.stringMatching(AMOUNT),
      currency: 'PLN',
    });
    // The refusal is true of its own figures.
    expect(Number(details?.orderTotal)).toBeGreaterThan(Number(details?.availableAmount));
    // No more than the buyer's own credit-limit endpoint already tells them.
    expect(Number(details?.availableAmount)).toBeGreaterThan(0);
  });

  it('en — the sentence names both amounts with their currency', async () => {
    const { message, details } = await refusal('en');
    expect(message).toBe(
      `The available credit limit (${String(details?.availableAmount)} PLN) does not cover this order ` +
        `(${String(details?.orderTotal)} PLN). Reduce the order or choose a different payment method.`,
    );
  });

  it('pl — the Polish sentence names them too, and is not the English fallback', async () => {
    const { message, details } = await refusal('pl');
    expect(message).toBe(
      `Dostępny limit kredytowy (${String(details?.availableAmount)} PLN) nie pokrywa wartości tego zamówienia ` +
        `(${String(details?.orderTotal)} PLN). Zmniejsz zamówienie albo wybierz inną metodę płatności.`,
    );
    // An unfilled placeholder makes the envelope answer with what the thrower
    // wrote, in English — which the assertion above would also catch, but this
    // is the failure it would be.
    expect(message).not.toMatch(/Available credit limit|\{/);
  });
});
