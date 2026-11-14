import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { AdminUser, Order, Payment, PaymentMethod } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Issue #635 (#86) — the two refusals of the payment-method delete guard
 * (FR-003) were `409 VALIDATION_FAILED` with an English sentence. The envelope
 * never replaces that code's message, so an operator working in Polish read
 * English, and a client could not tell "this method is in use" from a malformed
 * request. Each now has a code, a sentence in English and Polish, and the values
 * the sentence names in `details`.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

const IN_USE = {
  en: (code: string) =>
    `Payment method "${code}" cannot be deleted: 1 payment(s) reference it. Set its status to "inactive" instead.`,
  pl: (code: string) =>
    `Nie można usunąć metody płatności „${code}”: odwołują się do niej płatności (liczba: 1). Zamiast tego ustaw jej status na „nieaktywna”.`,
};
const USAGE_UNKNOWN = {
  en: 'This payment method cannot be deleted: the "payments" module is switched off, so the platform cannot tell whether any payment references it. Switch the module on and try again, or set the method\'s status to "inactive".',
  pl: 'Nie można usunąć tej metody płatności: moduł „payments” jest wyłączony, więc platforma nie może ustalić, czy odwołuje się do niej jakakolwiek płatność. Włącz ten moduł i spróbuj ponownie albo ustaw status metody na „nieaktywna”.',
};

describe('payment-method delete refusals carry their own code and sentence (issue #635)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
  }, 60_000);

  afterAll(async () => {
    if (h) await setAdminLanguage(languageBefore);
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  }

  async function seedMethod(): Promise<{ id: string; code: string }> {
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `pm635_${randomUUID().slice(0, 8)}`,
      name: { default: 'Guarded method' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'confirmed',
      statusOnFailure: 'cancelled',
    });
    await em.persistAndFlush(method);
    return { id: method.id, code: method.code };
  }

  /** `payments.order_id` is a real foreign key, so the row needs a real order. */
  async function seedPayment(method: { id: string; code: string }): Promise<void> {
    const em = h.em();
    const address = {
      recipientName: 'A',
      street: 'S',
      city: 'C',
      postalCode: '00-000',
      country: 'PL',
    };
    const order = em.create(Order, {
      organizationId: randomUUID(),
      placedByCustomerAccountId: randomUUID(),
      salesChannelId: randomUUID(),
      deliveryAddress: address,
      billingAddress: address,
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'd', name: 'd', cost: 0 },
      paymentMethodId: method.id,
      paymentMethodSnapshot: { code: method.code, name: 'Guarded method', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '2.30',
      deliveryTotal: '0.00',
      total: '12.30',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    await em.persistAndFlush(
      em.create(Payment, {
        orderId: order.id,
        paymentMethodId: method.id,
        amount: '12.30',
        currency: 'PLN',
      }),
    );
  }

  async function methodStillThere(id: string): Promise<boolean> {
    return (await h.em().fork().findOne(PaymentMethod, { id })) !== null;
  }

  async function refusedDelete(id: string, code: string): Promise<ErrorBody['error']> {
    const response = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/payment-methods/${id}`,
      cookies: ADMIN_COOKIE,
    });
    expect(response.statusCode, response.body).toBe(409);
    const error = (response.json() as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  it.each(['en', 'pl'] as const)(
    'PAYMENT_METHOD_IN_USE while a payment references the method (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const method = await seedMethod();
      await seedPayment(method);

      const error = await refusedDelete(method.id, 'PAYMENT_METHOD_IN_USE');

      expect(error.details).toEqual({
        paymentMethodId: method.id,
        paymentMethodCode: method.code,
        paymentCount: 1,
      });
      expect(error.message).toBe(IN_USE[language](method.code));
      if (language === 'pl') expect(error.message).not.toBe(IN_USE.en(method.code));
      expect(await methodStillThere(method.id)).toBe(true);
    },
  );

  it.each(['en', 'pl'] as const)(
    'PAYMENT_METHOD_USAGE_UNKNOWN while `payments` is off (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const method = await seedMethod();

      const error = await withModuleOff('payments', 'deactivated', () =>
        refusedDelete(method.id, 'PAYMENT_METHOD_USAGE_UNKNOWN'),
      );

      expect(error.details).toEqual({ paymentMethodId: method.id, module: 'payments' });
      expect(error.message).toBe(USAGE_UNKNOWN[language]);
      if (language === 'pl') expect(error.message).not.toBe(USAGE_UNKNOWN.en);
      expect(await methodStillThere(method.id)).toBe(true);
    },
  );

  it('routes both codes to payment_methods, the module that raises them', () => {
    for (const code of ['PAYMENT_METHOD_IN_USE', 'PAYMENT_METHOD_USAGE_UNKNOWN']) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('payment_methods');
    }
  });
});
