import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { DeliveryMethod, PaymentMethod } from '../../helpers/package-entities.js';

/**
 * Feature 034 FR-003 — a payment method whose adapter is not registered must
 * not be offered at checkout.
 *
 * `PaymentMethodEligibilityService` implements exactly that, is unit-tested in
 * `test/unit/payment_methods/eligibility.test.ts`, and is **never constructed
 * in production**. `orders/plugin.ts` builds `ShippingMethodEligibilityService`
 * and passes it to the delivery routes; the payment routes take the same
 * optional `eligibility` dependency and are handed nothing. The route's own
 * doc comment says the validators "are layered on in US2 via the eligibility
 * service" — US2 layered them on for shipping only.
 *
 * The consequence is not cosmetic. A gateway whose provider module is switched
 * off, or whose adapter simply never registered, still appears in the checkout
 * payment list; the customer picks it and the failure surfaces at placement,
 * after they have committed to the order. The identical delivery-method case
 * has been filtered correctly since feature 035, which is what makes this a
 * gap rather than a decision — the two lists are built from the same shape by
 * the same plugin, and only one of them checks.
 *
 * The delivery assertion is here deliberately: it is the control. Without it a
 * future regression that removes *both* filters would leave this file passing
 * on the payment side for the wrong reason.
 */

const ORPHAN_ADAPTER = `no_such_adapter_${randomUUID().slice(0, 8)}`;

describe('payment methods — unregistered adapter [integration]', () => {
  let h: BackendServerHandle;
  let paymentCode: string;
  let deliveryCode: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    paymentCode = `orphan-pay-${randomUUID().slice(0, 8)}`;
    deliveryCode = `orphan-ship-${randomUUID().slice(0, 8)}`;

    em.create(PaymentMethod, {
      code: paymentCode,
      name: { default: 'Orphaned gateway' },
      kind: 'gateway',
      adapter: ORPHAN_ADAPTER,
      status: 'active',
      statusOnPending: 'pending_payment',
      statusOnSuccess: 'paid',
      statusOnFailure: 'payment_failed',
    });

    em.create(DeliveryMethod, {
      code: deliveryCode,
      name: { default: 'Orphaned carrier' },
      adapter: ORPHAN_ADAPTER,
      status: 'active',
      currency: 'PLN',
    });

    await em.flush();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function codesFrom(url: string): Promise<string[]> {
    const res = await h.app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data?: Array<{ code: string }> };
    return (body.data ?? []).map((row) => row.code);
  }

  it('control: the delivery list already drops an unregistered adapter', async () => {
    expect(await codesFrom('/api/v1/delivery-methods')).not.toContain(deliveryCode);
  });

  it('does not offer a payment method whose adapter is not registered (FR-003)', async () => {
    expect(await codesFrom('/api/v1/payment-methods')).not.toContain(paymentCode);
  });
});
