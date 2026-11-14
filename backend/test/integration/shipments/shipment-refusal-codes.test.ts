import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser, DeliveryMethod, Order } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Issue #637 (#86) — generating a shipment for an order that already has a
 * successful one, and the `receive_shipment` ingress marking a generated
 * shipment as failed, were `409 VALIDATION_FAILED` with an English literal.
 * Both requests are well-formed; the shipment's state refuses them. The
 * envelope never replaces that code's message, so a Polish-language operator
 * read English. Both are now `SHIPMENT_ALREADY_GENERATED`, with a
 * `details.code` token naming the refused write and a sentence per token.
 *
 * The sentences are written out here rather than read from the bundle: a test
 * that loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so each case sets it.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

const GENERATE = {
  en: 'This order already has a successfully generated shipment, so there is nothing to generate.',
  pl: 'To zamówienie ma już pomyślnie wygenerowaną przesyłkę, więc nie ma czego generować.',
};
const MARK_FAILED = {
  en: 'This shipment has already been generated successfully, so it cannot be marked as failed.',
  pl: 'Ta przesyłka została już pomyślnie wygenerowana, więc nie można oznaczyć jej jako nieudanej.',
};

describe('shipment refusals carry their own code and sentence (issue #637)', () => {
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

  /** An order on a manual-courier method, at a status the success outcome may move. */
  async function seedOrder(): Promise<string> {
    const em = h.em();
    const method = em.create(DeliveryMethod, {
      code: `s637_${randomUUID().slice(0, 8)}`,
      name: { default: 'Shipment refusals' },
      adapter: 'manual_courier',
      cost: '15.00',
      currency: 'PLN',
      status: 'active',
      statusOnSuccess: 'shipment_sent',
      statusOnFailure: 'processing',
    });
    await em.persistAndFlush(method);
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
      deliveryMethodId: method.id,
      deliveryMethodSnapshot: { code: method.code, name: 'Shipment refusals', cost: 15 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'bt', name: 'BT', kind: 'bank_transfer' },
      status: 'shipment_ready',
      subtotal: '100.00',
      taxTotal: '23.00',
      deliveryTotal: '15.00',
      total: '138.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    return order.id;
  }

  function generate(orderId: string) {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/shipments`,
      cookies: ADMIN_COOKIE,
    });
  }

  function receive(payload: Record<string, unknown>) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/shipments/receive',
      cookies: ADMIN_COOKIE,
      payload,
    });
  }

  /** An order whose one shipment the carrier has already confirmed. */
  async function generatedShipment(): Promise<{ orderId: string; shipmentId: string }> {
    const orderId = await seedOrder();
    const created = await generate(orderId);
    expect(created.statusCode, created.body).toBe(201);
    const shipmentId = (created.json() as { data: { id: string } }).data.id;
    const settled = await receive({ shipmentId, outcome: 'success' });
    expect(settled.statusCode, settled.body).toBe(200);
    return { orderId, shipmentId };
  }

  function refusal(response: { statusCode: number; body: string; json: () => unknown }) {
    expect(response.statusCode, response.body).toBe(409);
    const error = (response.json() as ErrorBody).error;
    expect(error.code).toBe('SHIPMENT_ALREADY_GENERATED');
    return error;
  }

  it.each(['en', 'pl'] as const)(
    'refuses to generate a shipment for an order that already has a successful one (%s)',
    async (language) => {
      const { orderId, shipmentId } = await generatedShipment();
      await setAdminLanguage(language);

      const error = refusal(await generate(orderId));

      expect(error.details).toEqual({ code: 'generate', orderId, shipmentId });
      expect(error.message).toBe(GENERATE[language]);
      if (language === 'pl') expect(error.message).not.toBe(GENERATE.en);
    },
  );

  it.each(['en', 'pl'] as const)(
    'refuses to mark a generated shipment as failed (%s)',
    async (language) => {
      const { orderId, shipmentId } = await generatedShipment();
      await setAdminLanguage(language);

      const error = refusal(
        await receive({ shipmentId, outcome: 'failure', failureReason: 'late' }),
      );

      expect(error.details).toEqual({
        code: 'mark_failed',
        shipmentId,
        orderId,
        status: 'success',
      });
      expect(error.message).toBe(MARK_FAILED[language]);
      if (language === 'pl') expect(error.message).not.toBe(MARK_FAILED.en);
    },
  );

  it('routes the code to shipments, the module that raises it', () => {
    expect(DECLARED_ERROR_TRANSLATION_TARGETS['SHIPMENT_ALREADY_GENERATED']?.moduleId).toBe(
      'shipments',
    );
  });
});
