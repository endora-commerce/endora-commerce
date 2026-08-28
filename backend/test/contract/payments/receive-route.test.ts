import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PaymentMethod } from '../../helpers/package-entities.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';

/**
 * T036 (US3) — POST /api/v1/payments/receive + GET /admin/orders/:id/payments.
 */
describe('payments receive route', () => {
  let h: BackendServerHandle;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seed(): Promise<{ orderId: string; paymentId: string }> {
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `route_${randomUUID().slice(0, 8)}`,
      name: { default: 'Route' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'confirmed',
      statusOnFailure: 'cancelled',
    });
    await em.persistAndFlush(method);
    const order = em.create(Order, {
      organizationId: randomUUID(),
      placedByCustomerAccountId: randomUUID(),
      salesChannelId: randomUUID(),
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'd', name: 'd', cost: 0 },
      paymentMethodId: method.id,
      paymentMethodSnapshot: { code: method.code, name: 'Route', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '2.30',
      deliveryTotal: '0.00',
      total: '12.30',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    const payment = em.create(Payment, {
      orderId: order.id,
      paymentMethodId: method.id,
      amount: '12.30',
      currency: 'PLN',
    });
    await em.persistAndFlush(payment);
    return { orderId: order.id, paymentId: payment.id };
  }

  it('settles a payment on success and lists it in the order history', async () => {
    const { orderId, paymentId } = await seed();

    const receive = await h.app.inject({
      method: 'POST',
      url: '/api/v1/payments/receive',
      ...admin,
      payload: { paymentId, outcome: 'success', externalReference: 'tx-1' },
    });
    expect(receive.statusCode).toBe(200);
    expect((receive.json() as { data: { status: string } }).data.status).toBe('paid');

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orderId}/payments`,
      ...admin,
    });
    expect(list.statusCode).toBe(200);
    const payments = (list.json() as { data: Array<{ status: string }> }).data;
    expect(payments).toHaveLength(1);
    expect(payments[0]!.status).toBe('paid');
  });

  /**
   * `providerDetails` is a third operator-supplied write path into
   * `payments.provider_details`, and until it was bounded the route persisted
   * whatever JSON document arrived, verbatim, into a column
   * `GET /admin/orders/:id/payments` echoes back in full. What we persist there
   * has to be bounded by our schema rather than by the caller's: the route body
   * takes a flat map of scalars, which is what an operator settling an offline
   * payment by hand actually records.
   *
   * The bound is on the **route body** and not on `ReceivePayment` itself,
   * because the gateway modules build that type in code with their own key
   * vocabulary — `paymentIntentId`, `payuRegisterOneClickAlias`, a nested
   * status envelope — and those paths are a different repair with a different
   * owner.
   */
  it('accepts a flat scalar providerDetails from an operator', async () => {
    const { paymentId } = await seed();

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/payments/receive',
      ...admin,
      payload: {
        paymentId,
        outcome: 'success',
        externalReference: 'tx-flat',
        providerDetails: { bankStatementLine: '2026-08-28/17', settledManually: true, amount: 12.3 },
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a nested providerDetails document', async () => {
    const { paymentId } = await seed();

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/payments/receive',
      ...admin,
      payload: {
        paymentId,
        outcome: 'success',
        externalReference: 'tx-nested',
        providerDetails: { raw: { anything: ['at', 'all'] } },
      },
    });
    expect(res.statusCode).toBe(400);

    // And nothing was written: a refusal that settles the payment anyway is not
    // a refusal.
    const payment = await h.em().findOne(Payment, { id: paymentId });
    expect(payment!.status).not.toBe('paid');
  });

  it('rejects a malformed payload (no reference)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/payments/receive',
      ...admin,
      payload: { outcome: 'success' },
    });
    expect(res.statusCode).toBe(400);
  });
});
