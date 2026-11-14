import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser, Order, Payment, PaymentMethod } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Issue #630 (#86) — the admin payment retry and the `receive_payment` ingress
 * refused a payment in a terminal state with `409 VALIDATION_FAILED` and an
 * English literal. The request is well formed; the payment's state refuses it.
 * The envelope never replaces the message of `VALIDATION_FAILED`, so an
 * operator working in Polish read English, and a client could not tell these
 * refusals from a malformed body. Each now has its own code, a sentence in
 * English and Polish, and the values a client needs in `details`.
 *
 * The retry of a paid order and the ingress marking a paid payment failed are
 * one state seen from two callers, so they share `PAYMENT_ALREADY_PAID` and a
 * `details.code` token picks the sentence (`retry` / `mark_failed`), as
 * `SHIPMENT_ALREADY_GENERATED` does for its two callers (issue #637).
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

type Language = 'en' | 'pl';

const ALREADY_PAID_RETRY: Record<Language, string> = {
  en: 'This order is already paid, so there is nothing to retry.',
  pl: 'To zamówienie jest już opłacone, więc nie ma czego ponawiać.',
};
const ALREADY_PAID_MARK_FAILED: Record<Language, (paymentId: string) => string> = {
  en: (paymentId) => `Payment ${paymentId} is already paid, so it cannot be marked as failed.`,
  pl: (paymentId) => `Płatność ${paymentId} jest już opłacona, więc nie można oznaczyć jej jako nieudanej.`,
};
const REFUNDED: Record<Language, string> = {
  en: 'This payment has been refunded, so it cannot be retried.',
  pl: 'Ta płatność została zwrócona, więc nie można jej ponowić.',
};
const SETTLED_OUT_OF_BAND: Record<Language, string> = {
  en: 'This order is settled outside the payment gateway, so there is nothing to retry.',
  pl: 'To zamówienie jest rozliczane poza bramką płatności, więc nie ma czego ponawiać.',
};

type PaymentStatus = 'paid' | 'refunded' | 'partially_refunded' | 'deferred';

describe('payments refusals carry their own code and sentence (issue #630)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  const admin = { b2b_session: 'stub-admin-session' };
  /** Only the rows this file creates are removed — never a table-wide wipe. */
  const created = { payments: [] as string[], orders: [] as string[], methods: [] as string[] };

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      const connection = h.em().getConnection();
      const ids = (list: string[]) => `{${list.join(',')}}`;
      if (created.payments.length > 0) {
        await connection.execute(`delete from "payments" where "id" = any(?::uuid[])`, [ids(created.payments)]);
      }
      if (created.orders.length > 0) {
        await connection.execute(`delete from "orders" where "id" = any(?::uuid[])`, [ids(created.orders)]);
      }
      if (created.methods.length > 0) {
        await connection.execute(`delete from "payment_methods" where "id" = any(?::uuid[])`, [ids(created.methods)]);
      }
    }
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const user = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    user.preferredLanguage = value;
    await em.flush();
  }

  /** An order of this file's own whose one payment attempt is in `status`. */
  async function seed(status: PaymentStatus): Promise<{ orderId: string; paymentId: string }> {
    const em = h.em().fork();
    const method = em.create(PaymentMethod, {
      code: `i630_${randomUUID().slice(0, 8)}`,
      name: { default: 'Payment state refusals' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'confirmed',
      statusOnFailure: 'cancelled',
    });
    await em.persistAndFlush(method);
    created.methods.push(method.id);
    const address = { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' };
    const order = em.create(Order, {
      organizationId: randomUUID(),
      placedByCustomerAccountId: randomUUID(),
      salesChannelId: randomUUID(),
      deliveryAddress: address,
      billingAddress: address,
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'd', name: 'd', cost: 0 },
      paymentMethodId: method.id,
      paymentMethodSnapshot: { code: method.code, name: 'Payment state refusals', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '2.30',
      deliveryTotal: '0.00',
      total: '12.30',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    created.orders.push(order.id);
    const payment = em.create(Payment, {
      orderId: order.id,
      paymentMethodId: method.id,
      amount: '12.30',
      currency: 'PLN',
      status,
    });
    await em.persistAndFlush(payment);
    created.payments.push(payment.id);
    return { orderId: order.id, paymentId: payment.id };
  }

  function refusal(response: { statusCode: number; body: string }, status: number, code: string): ErrorBody['error'] {
    expect(response.statusCode, response.body).toBe(status);
    const error = (JSON.parse(response.body) as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  function expectTranslated(error: ErrorBody['error'], language: Language, sentence: Record<Language, string>): void {
    expect(error.message).toBe(sentence[language]);
    if (language === 'pl') expect(error.message).not.toBe(sentence.en);
  }

  const retry = (orderId: string) =>
    h.app.inject({ method: 'POST', url: `/api/v1/admin/orders/${orderId}/payments/retry`, cookies: admin });

  describe.each(['en', 'pl'] as const)('for an operator working in %s', (language) => {
    beforeAll(async () => {
      await setAdminLanguage(language);
    });

    it('PAYMENT_ALREADY_PAID (retry) when the order is already paid', async () => {
      const { orderId, paymentId } = await seed('paid');

      const error = refusal(await retry(orderId), 409, 'PAYMENT_ALREADY_PAID');

      expect(error.details).toEqual({ code: 'retry', orderId, paymentId, status: 'paid' });
      expectTranslated(error, language, ALREADY_PAID_RETRY);
    });

    it.each(['refunded', 'partially_refunded'] as const)(
      'PAYMENT_REFUNDED when the payment is %s',
      async (status) => {
        const { orderId, paymentId } = await seed(status);

        const error = refusal(await retry(orderId), 409, 'PAYMENT_REFUNDED');

        expect(error.details).toEqual({ orderId, paymentId, status });
        expectTranslated(error, language, REFUNDED);
      },
    );

    it('PAYMENT_SETTLED_OUT_OF_BAND when the order is settled out of band', async () => {
      const { orderId, paymentId } = await seed('deferred');

      const error = refusal(await retry(orderId), 409, 'PAYMENT_SETTLED_OUT_OF_BAND');

      expect(error.details).toEqual({ orderId, paymentId });
      expectTranslated(error, language, SETTLED_OUT_OF_BAND);
    });

    it('PAYMENT_ALREADY_PAID (mark_failed) when the ingress marks a paid payment failed', async () => {
      const { orderId, paymentId } = await seed('paid');

      const error = refusal(
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/payments/receive',
          cookies: admin,
          payload: { paymentId, outcome: 'failure', externalReference: `i630-${randomUUID().slice(0, 8)}` },
        }),
        409,
        'PAYMENT_ALREADY_PAID',
      );

      expect(error.details).toEqual({ code: 'mark_failed', orderId, paymentId, status: 'paid' });
      expectTranslated(error, language, {
        en: ALREADY_PAID_MARK_FAILED.en(paymentId),
        pl: ALREADY_PAID_MARK_FAILED.pl(paymentId),
      });
      // Refused, not downgraded.
      const after = await h.em().fork().findOneOrFail(Payment, { id: paymentId });
      expect(after.status).toBe('paid');
    });
  });

  it('routes the three codes to payments, the module that raises them', () => {
    for (const code of ['PAYMENT_ALREADY_PAID', 'PAYMENT_REFUNDED', 'PAYMENT_SETTLED_OUT_OF_BAND']) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('payments');
    }
  });
});
