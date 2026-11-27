import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrderCommandPort, PaymentMethodReadPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ReceivePaymentHandler } from '../../../../packages/modules/payments/src/backend/services/receive-payment-handler.js';
import type { OrderPaymentStatusApplyPort, OrderPaymentSettlementEffectsPort } from '../../../../packages/modules/orders/src/ports/index.js';
import { PaymentMethod } from '../../helpers/package-entities.js';
import { Order } from '../../helpers/package-entities.js';
import { Payment } from '../../helpers/package-entities.js';

/**
 * Issue #1574 — settlement respects the money axis's transition graph.
 *
 * `payments` wrote `orders.payment_status` through `orderPaymentStatusApplyPort`
 * from any state, so a late decline overwrote an order an operator had marked
 * `paid` with `failed` (and then put it on hold through `status_on_failure`),
 * and a late success set a `refunded` order back to `paid`. The port now
 * answers `applied`, `unchanged` or `refused`, never throws on a refusal — the
 * payment row records a true provider fact and must commit — and the handler
 * asks for no lifecycle move behind a refused one.
 */

type OrderPaymentStatus = 'awaiting_payment' | 'paid' | 'failed' | 'deferred' | 'refunded';

interface Fixture {
  order: Order;
  payment: Payment;
}

async function seed(em: EntityManager, paymentStatus: OrderPaymentStatus, orderStatus = 'processing'): Promise<Fixture> {
  const method = em.create(PaymentMethod, {
    code: `sg_${randomUUID().slice(0, 8)}`,
    name: { default: 'SG' },
    kind: 'bank_transfer',
    adapter: 'bank_transfer',
    status: 'active',
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'on_hold',
  });
  await em.persist(method).flush();

  const order = em.create(Order, {
    organizationId: randomUUID(),
    placedByCustomerAccountId: randomUUID(),
    salesChannelId: randomUUID(),
    status: orderStatus,
    paymentStatus,
    deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'd', name: 'd', cost: 0 },
    paymentMethodId: method.id,
    paymentMethodSnapshot: { code: method.code, name: 'SG', kind: 'bank_transfer', adapter: method.adapter },
    subtotal: '100.00',
    taxTotal: '23.00',
    deliveryTotal: '0.00',
    total: '123.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persist(order).flush();

  const payment = em.create(Payment, {
    orderId: order.id,
    paymentMethodId: method.id,
    amount: '123.00',
    currency: 'PLN',
  });
  await em.persist(payment).flush();
  return { order, payment };
}

describe('settlement respects the payment-status graph (issue #1574)', () => {
  let h: BackendServerHandle;
  let warnings: Array<{ details: Record<string, unknown>; message: string }>;

  const port = (): OrderPaymentStatusApplyPort =>
    h.container.resolve<OrderPaymentStatusApplyPort>('orderPaymentStatusApplyPort');

  const handler = (): ReceivePaymentHandler =>
    new ReceivePaymentHandler(
      h.em,
      h.container.resolve<PaymentMethodReadPort>('paymentMethodReadPort'),
      h.container.resolve<OrderCommandPort>('orderCommandPort'),
      port(),
      h.container.resolve<OrderPaymentSettlementEffectsPort>('orderPaymentSettlementEffectsPort'),
      { warn: (details, message) => warnings.push({ details: details as Record<string, unknown>, message }) },
    );

  const reload = async (orderId: string) => (await h.em().fork().findOne(Order, { id: orderId }))!;
  const reloadPayment = async (paymentId: string) => (await h.em().fork().findOne(Payment, { id: paymentId }))!;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  beforeEach(() => {
    warnings = [];
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  // --- P1 — the port's three answers ------------------------------------------

  it.each([
    ['awaiting_payment', 'paid', 'applied', 'paid'],
    ['awaiting_payment', 'failed', 'applied', 'failed'],
    ['failed', 'failed', 'unchanged', 'failed'],
    ['paid', 'refunded', 'applied', 'refunded'],
    ['paid', 'failed', 'refused', 'paid'],
    ['refunded', 'paid', 'refused', 'refunded'],
    ['awaiting_payment', 'refunded', 'refused', 'awaiting_payment'],
  ] as const)('P1 — %s -> %s answers %s and leaves the order at %s', async (from, to, outcome, after) => {
    const { order } = await seed(h.em(), from);

    const answer = await h.em().fork().transactional((tx) =>
      port().applyPaymentStatus(tx, { orderId: order.id, paymentStatus: to }),
    );

    expect(answer).toMatchObject({ orderId: order.id, outcome, paymentStatus: after });
    expect((await reload(order.id)).paymentStatus).toBe(after);
  });

  // --- P2 / P3 — late provider facts do not overwrite a settled order ---------

  it('P2 — a late decline on an order marked paid by hand records the attempt and leaves the order alone', async () => {
    const { order, payment } = await seed(h.em(), 'paid');

    const res = await handler().receive({ paymentId: payment.id, outcome: 'failure', failureReason: 'late decline' });

    expect(res.status).toBe('failed');
    expect((await reloadPayment(payment.id)).status).toBe('failed');
    const after = await reload(order.id);
    expect(after.paymentStatus).toBe('paid');
    // No `status_on_failure` (on_hold) behind a refused move.
    expect(after.status).toBe('processing');
    expect(await h.auditLogService.query({ action: 'order.status_transition', objectId: order.id })).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.details).toMatchObject({ paymentId: payment.id, orderId: order.id, from: 'paid', to: 'failed' });
  });

  it('P3 — a late success on a refunded order records the payment and does not mark the order paid', async () => {
    const { order, payment } = await seed(h.em(), 'refunded', 'on_hold');

    const res = await handler().receive({ paymentId: payment.id, outcome: 'success' });

    expect(res.status).toBe('paid');
    expect((await reloadPayment(payment.id)).status).toBe('paid');
    const after = await reload(order.id);
    expect(after.paymentStatus).toBe('refunded');
    // No `status_on_success` (paid) behind a refused move.
    expect(after.status).toBe('on_hold');
    expect(warnings[0]!.details).toMatchObject({ paymentId: payment.id, orderId: order.id, from: 'refunded', to: 'paid' });
  });

  // --- P4 — what already worked still does --------------------------------------

  it('P4 — success after a failure settles; a second decline is a no-op; partial then full refund on paid', async () => {
    const { order, payment } = await seed(h.em(), 'awaiting_payment', 'new');
    const settle = handler();

    await settle.receive({ paymentId: payment.id, outcome: 'failure', failureReason: 'first' });
    await settle.receive({ paymentId: payment.id, outcome: 'failure', failureReason: 'second' });
    let after = await reload(order.id);
    expect(after.paymentStatus).toBe('failed');
    expect(after.status).toBe('on_hold');

    await settle.receive({ paymentId: payment.id, outcome: 'success' });
    after = await reload(order.id);
    expect(after.paymentStatus).toBe('paid');
    expect(after.status).toBe('paid');

    await settle.reflectRefund({ paymentId: payment.id, refundedAmount: 1, currency: 'PLN', fullyRefunded: false });
    expect((await reload(order.id)).paymentStatus).toBe('paid');
    await settle.reflectRefund({ paymentId: payment.id, refundedAmount: 123, currency: 'PLN', fullyRefunded: true });
    after = await reload(order.id);
    expect(after.paymentStatus).toBe('refunded');
    expect(after.status).toBe('on_hold');
    expect(warnings).toEqual([]);
  });

  // --- P5 — a full refund on an unpaid order is held for review ---------------

  it('P5 — a full refund reported for an awaiting_payment order leaves the column and still holds the order', async () => {
    const { order, payment } = await seed(h.em(), 'awaiting_payment');

    await handler().reflectRefund({ paymentId: payment.id, refundedAmount: 123, currency: 'PLN', fullyRefunded: true });

    expect((await reloadPayment(payment.id)).status).toBe('refunded');
    const after = await reload(order.id);
    expect(after.paymentStatus).toBe('awaiting_payment');
    expect(after.status).toBe('on_hold');
  });
});
