import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ReceivePaymentHandler } from '../../../src/modules/payments/services/receive-payment-handler.js';
import { PaymentService } from '../../../src/modules/payments/services/payment-service.js';
import { EnumOrderStatusRegistry } from '../../../src/modules/payment_methods/services/order-status-registry.port.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';

interface Fixture {
  method: PaymentMethod;
  order: Order;
  payment: Payment;
}

async function seedOrderWithPayment(
  em: EntityManager,
  opts: { adapter?: string; statusOnSuccess?: string; statusOnFailure?: string } = {},
): Promise<Fixture> {
  const method = em.create(PaymentMethod, {
    code: `rp_${randomUUID().slice(0, 8)}`,
    name: { default: 'RP' },
    kind: 'bank_transfer',
    adapter: opts.adapter ?? 'bank_transfer',
    status: 'active',
    statusOnPending: 'new',
    statusOnSuccess: opts.statusOnSuccess ?? 'completed',
    statusOnFailure: opts.statusOnFailure ?? 'cancelled',
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
    paymentMethodSnapshot: { code: method.code, name: 'RP', kind: 'bank_transfer', adapter: method.adapter },
    subtotal: '100.00',
    taxTotal: '23.00',
    deliveryTotal: '0.00',
    total: '123.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);

  const payment = em.create(Payment, {
    orderId: order.id,
    paymentMethodId: method.id,
    amount: '123.00',
    currency: 'PLN',
  });
  await em.persistAndFlush(payment);

  return { method, order, payment };
}

describe('ReceivePaymentHandler', () => {
  let h: BackendServerHandle;
  const registry = new EnumOrderStatusRegistry();

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('marks the Payment paid and applies statusOnSuccess (T034)', async () => {
    const { order, payment } = await seedOrderWithPayment(h.em());
    const handler = new ReceivePaymentHandler(h.em, registry);

    const res = await handler.receive({
      paymentId: payment.id,
      outcome: 'success',
      externalReference: 'psp-123',
      providerDetails: { gatewayTxn: 'abc' },
    });
    expect(res.status).toBe('paid');

    const em = h.em();
    const reloadedPayment = await em.findOne(Payment, { id: payment.id });
    expect(reloadedPayment!.status).toBe('paid');
    expect(reloadedPayment!.externalReference).toBe('psp-123');
    expect(reloadedPayment!.providerDetails).toMatchObject({ gatewayTxn: 'abc' });
    const reloadedOrder = await em.findOne(Order, { id: order.id });
    expect(reloadedOrder!.status).toBe('completed');
    expect(reloadedOrder!.paymentStatus).toBe('paid');
  });

  it('marks the Payment failed and applies statusOnFailure (T034)', async () => {
    const { order, payment } = await seedOrderWithPayment(h.em());
    const handler = new ReceivePaymentHandler(h.em, registry);

    const res = await handler.receive({
      paymentId: payment.id,
      outcome: 'failure',
      failureReason: 'card declined',
    });
    expect(res.status).toBe('failed');

    const em = h.em();
    const reloadedPayment = await em.findOne(Payment, { id: payment.id });
    expect(reloadedPayment!.status).toBe('failed');
    expect(reloadedPayment!.failureReason).toBe('card declined');
    const reloadedOrder = await em.findOne(Order, { id: order.id });
    expect(reloadedOrder!.status).toBe('cancelled');
  });

  it('is idempotent on repeated success and rejects failure after paid (T035)', async () => {
    const { payment } = await seedOrderWithPayment(h.em());
    const handler = new ReceivePaymentHandler(h.em, registry);

    await handler.receive({ paymentId: payment.id, outcome: 'success' });
    const again = await handler.receive({ paymentId: payment.id, outcome: 'success' });
    expect(again.idempotent).toBe(true);

    await expect(
      handler.receive({ paymentId: payment.id, outcome: 'failure', failureReason: 'late' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('opens a retry Payment after a failure, preserving prior attempts (T035)', async () => {
    const { order, payment } = await seedOrderWithPayment(h.em());
    const handler = new ReceivePaymentHandler(h.em, registry);
    const service = new PaymentService(h.em);

    await handler.receive({ paymentId: payment.id, outcome: 'failure', failureReason: 'x' });
    const retry = await service.openRetry(order.id);

    expect(retry.attemptNo).toBe(2);
    expect(retry.status).toBe('awaiting_payment');
    const all = await service.listForOrder(order.id);
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.attemptNo)).toEqual([1, 2]);
  });

  it('reconciles a late receive even when the adapter is de-registered (T036a / R6)', async () => {
    // The method references an adapter key that is NOT in any registry; the
    // handler keys on the persisted Payment, so the late event still settles.
    const { order, payment } = await seedOrderWithPayment(h.em(), { adapter: 'removed_adapter' });
    const handler = new ReceivePaymentHandler(h.em, registry);

    const res = await handler.receive({ paymentId: payment.id, outcome: 'success' });
    expect(res.status).toBe('paid');
    const reloadedOrder = await h.em().findOne(Order, { id: order.id });
    expect(reloadedOrder!.status).toBe('completed');
  });
});
