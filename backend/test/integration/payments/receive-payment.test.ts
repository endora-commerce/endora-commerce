import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OrderReadPort,
  OrderTransitionPort,
  PaymentMethodReadPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  ReceivePaymentHandler,
  type SettlementLogger,
} from '../../../src/modules/payments/services/receive-payment-handler.js';
import { PaymentService } from '../../../src/modules/payments/services/payment-service.js';
import { PaymentMethod, type PaymentMethodRow } from '../../helpers/package-entities.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';

interface Fixture {
  method: PaymentMethodRow;
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
    // The shipped seeds, both of them: `paid` is where a first success takes an
    // order (the edge feature 085 Phase A added) and `on_hold` is where a
    // decline leaves it (Phase C). A fixture naming a target the configured
    // graph cannot reach would assert the ingress forcing it, which is the
    // defect Phase D removed.
    statusOnSuccess: opts.statusOnSuccess ?? 'paid',
    statusOnFailure: opts.statusOnFailure ?? 'on_hold',
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
  /** Refusals the cases below do not assert on; the ones that do are elsewhere. */
  const quiet: SettlementLogger = { warn: () => undefined };
  /**
   * The two cross-module seams the handler uses, resolved off the composed
   * container rather than stubbed (feature 075 C-W3; feature 085 Phase D). Both
   * are gated ports, so resolving them here is what the four gateways do
   * through `receivePaymentPort`, and a test that stubbed them would stop
   * exercising the seam it is here to keep honest — the lifecycle one above
   * all, since the whole point of Phase D is that the graph now answers.
   */
  const handlerPorts = (): [PaymentMethodReadPort, OrderTransitionPort, SettlementLogger] => [
    h.container.resolve<PaymentMethodReadPort>('paymentMethodReadPort'),
    h.container.resolve<OrderTransitionPort>('orderTransitionPort'),
    quiet,
  ];

  /**
   * The service under test, with the real `orderReadPort` behind it.
   *
   * `PaymentService` reads the order through that port before every
   * order-keyed operation, because `Payment` carries no tenant filter of its
   * own — so a stub here would be asserting the guard away rather than
   * exercising it. These cases run in the harness's system scope, where the
   * port answers for every order.
   */
  const paymentService = (): PaymentService =>
    new PaymentService(h.em, h.container.resolve<OrderReadPort>('orderReadPort'));

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('marks the Payment paid and applies statusOnSuccess (T034)', async () => {
    const { order, payment } = await seedOrderWithPayment(h.em());
    const handler = new ReceivePaymentHandler(h.em, ...handlerPorts());

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
    expect(reloadedOrder!.status).toBe('paid');
    expect(reloadedOrder!.paymentStatus).toBe('paid');
  });

  /**
   * Feature 085 (FR-001/FR-002/FR-003) — a declined payment holds the order and
   * says so on the money axis.
   *
   * Both halves matter and they used to be one. Before this feature the failure
   * outcome wrote the lifecycle status alone, `paymentStatus` stayed
   * `awaiting_payment`, and the shipped `status_on_failure` was `cancelled` —
   * terminal, unreachable from anywhere, so the buyer's most recoverable
   * mistake destroyed the order they were trying to pay for. The fixture's
   * default is the shipped default, so this test fails if either half regresses.
   */
  it('marks the Payment failed, holds the order and records the decline (T034 / 085)', async () => {
    const { order, payment } = await seedOrderWithPayment(h.em());
    const handler = new ReceivePaymentHandler(h.em, ...handlerPorts());

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
    const reloadedOrder = await em.findOne(Order, { id: order.id }, { refresh: true });
    expect(reloadedOrder!.status).toBe('on_hold');
    expect(reloadedOrder!.paymentStatus).toBe('failed');
  });

  /**
   * FR-006 — a second decline on an order already at the failure status is a
   * no-op on the lifecycle and still records the attempt. The buyer may keep
   * trying, and each attempt is its own row.
   */
  it('leaves a second decline where the first one put the order (085 FR-006)', async () => {
    const { order, payment } = await seedOrderWithPayment(h.em());
    const handler = new ReceivePaymentHandler(h.em, ...handlerPorts());

    await handler.receive({ paymentId: payment.id, outcome: 'failure', failureReason: 'first' });
    const second = await handler.receive({
      paymentId: payment.id,
      outcome: 'failure',
      failureReason: 'second',
    });

    expect(second.status).toBe('failed');
    const em = h.em();
    const reloadedPayment = await em.findOne(Payment, { id: payment.id }, { refresh: true });
    expect(reloadedPayment!.failureReason).toBe('second');
    const reloadedOrder = await em.findOne(Order, { id: order.id }, { refresh: true });
    expect(reloadedOrder!.status).toBe('on_hold');
    expect(reloadedOrder!.paymentStatus).toBe('failed');
  });

  /**
   * The late success feature 085's edge cases name: the decline held the order
   * rather than ending it, so the success that follows it reaches the method's
   * success status and the money axis returns to `paid`. `on_hold` is a
   * universal transition *source*, which is what makes the second half of this
   * reachable at all.
   */
  it('lets a success after a failure settle the order (085 edge case)', async () => {
    const { order, payment } = await seedOrderWithPayment(h.em());
    const handler = new ReceivePaymentHandler(h.em, ...handlerPorts());

    await handler.receive({ paymentId: payment.id, outcome: 'failure', failureReason: 'declined' });
    await handler.receive({ paymentId: payment.id, outcome: 'success' });

    const reloadedOrder = await h.em().findOne(Order, { id: order.id }, { refresh: true });
    expect(reloadedOrder!.status).toBe('paid');
    expect(reloadedOrder!.paymentStatus).toBe('paid');
  });

  it('is idempotent on repeated success and rejects failure after paid (T035)', async () => {
    const { payment } = await seedOrderWithPayment(h.em());
    const handler = new ReceivePaymentHandler(h.em, ...handlerPorts());

    await handler.receive({ paymentId: payment.id, outcome: 'success' });
    const again = await handler.receive({ paymentId: payment.id, outcome: 'success' });
    expect(again.idempotent).toBe(true);

    await expect(
      handler.receive({ paymentId: payment.id, outcome: 'failure', failureReason: 'late' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('opens a retry Payment after a failure, preserving prior attempts (T035)', async () => {
    const { order, payment } = await seedOrderWithPayment(h.em());
    const handler = new ReceivePaymentHandler(h.em, ...handlerPorts());
    const service = paymentService();

    await handler.receive({ paymentId: payment.id, outcome: 'failure', failureReason: 'x' });
    const retry = await service.openRetry(order.id);

    expect(retry.opened).toBe(true);
    expect(retry.payment.attemptNo).toBe(2);
    expect(retry.payment.status).toBe('awaiting_payment');
    const all = await service.listForOrder(order.id);
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.attemptNo)).toEqual([1, 2]);
  });

  /**
   * Issue #264 — a second ask while an attempt is open resumes it.
   *
   * The buyer's retry route starts a provider session for every attempt this
   * *opens*, so a second row here is a second live object at the PSP for one
   * order. Two clicks on one button is the ordinary way to produce it, and PayU
   * makes the consequence concrete: it keys its order on `extOrderId`, which is
   * this platform's payment id.
   */
  it('resumes the open attempt instead of opening a second one (#264)', async () => {
    const { order } = await seedOrderWithPayment(h.em());
    const service = paymentService();

    const first = await service.openRetry(order.id);
    expect(first.opened).toBe(false);
    expect(first.payment.attemptNo).toBe(1);

    const second = await service.openRetry(order.id);
    expect(second.opened).toBe(false);
    expect(await service.listForOrder(order.id)).toHaveLength(1);
  });

  /**
   * Issue #264 — the refusals `openRetry` owes a settled order.
   *
   * `paid` was already refused; `refunded` and `deferred` were not, so a
   * refunded order and a credit-limit order each opened an attempt no gateway
   * would ever settle — and, once the buyer's route existed, one that would
   * have taken the buyer to a payment page for money they do not owe.
   */
  it('refuses to open an attempt against a settled payment (#264)', async () => {
    const service = paymentService();

    for (const status of ['paid', 'refunded', 'partially_refunded', 'deferred'] as const) {
      const { order, payment } = await seedOrderWithPayment(h.em());
      payment.status = status;
      await h.em().persistAndFlush(payment);
      await expect(service.openRetry(order.id)).rejects.toMatchObject({ statusCode: 409 });
      expect(await service.listForOrder(order.id)).toHaveLength(1);
    }
  });

  /**
   * Issue #264 — `failAttempt` closes an attempt whose provider session never
   * started, and touches nothing else.
   */
  it('fails only an open attempt, so a settled one is never downgraded (#264)', async () => {
    const { order, payment } = await seedOrderWithPayment(h.em());
    const service = paymentService();

    await service.failAttempt(payment.id, 'gateway refused');
    const [afterFail] = await service.listForOrder(order.id);
    expect(afterFail?.status).toBe('failed');
    expect(afterFail?.failureReason).toBe('gateway refused');

    const settled = await seedOrderWithPayment(h.em());
    settled.payment.status = 'paid';
    await h.em().persistAndFlush(settled.payment);
    await service.failAttempt(settled.payment.id, 'late');
    const [untouched] = await service.listForOrder(settled.order.id);
    expect(untouched?.status).toBe('paid');
  });

  /**
   * Feature 075 C-W3, narrowed by feature 085 Phase D — the payment row and the
   * order's **payment status** commit or roll back together, which is the pair
   * `payments_order_fk` holds and the whole of what D-78 point 2 rules
   * co-transactional.
   *
   * The lifecycle status is no longer in that pair, and this case says so from
   * both sides: it is not written inside the transaction, and it is therefore
   * unmoved when the transaction rolls back. The oversized value that used to
   * force the failure was a `statusOnSuccess` too long for `orders.status`,
   * which cannot fail a flush any more for exactly that reason — the handler
   * never writes that column. An `externalReference` longer than
   * `payments.external_reference` (`varchar(255)`) puts the failure back at the
   * flush, after `receive()` has stamped `payment.status = 'paid'` / `paidAt`
   * and `order.paymentStatus`.
   */
  it('rolls the payment back with the order payment status when the flush fails (C-W3)', async () => {
    const { order, payment } = await seedOrderWithPayment(h.em());
    const handler = new ReceivePaymentHandler(h.em, ...handlerPorts());
    const tooLongForTheColumn = 'x'.repeat(300);

    // Asserted on the message, so the test cannot pass by failing *earlier*
    // than the writes it is here to roll back: this is Postgres refusing the
    // write, which only happens once the unit of work flushes both rows.
    await expect(
      handler.receive({
        paymentId: payment.id,
        outcome: 'success',
        externalReference: tooLongForTheColumn,
      }),
    ).rejects.toThrow(/value too long for type character varying\(255\)/i);

    const em = h.em();
    const reloadedPayment = await em.findOne(Payment, { id: payment.id }, { refresh: true });
    expect(reloadedPayment!.status).toBe('awaiting_payment');
    expect(reloadedPayment!.paidAt ?? null).toBeNull();
    const reloadedOrder = await em.findOne(Order, { id: order.id }, { refresh: true });
    // Unmoved because the transition is asked for after the commit and the
    // commit never happened — not because a rollback reached it. A port call
    // made from inside the transaction would have written this column on a
    // second connection that the rollback could not reach, and this line would
    // read `paid` (issue #200).
    expect(reloadedOrder!.status).toBe('new');
    expect(reloadedOrder!.paymentStatus).toBe('awaiting_payment');
  });

  it('reconciles a late receive even when the adapter is de-registered (T036a / R6)', async () => {
    // The method references an adapter key that is NOT in any registry; the
    // handler keys on the persisted Payment, so the late event still settles.
    const { order, payment } = await seedOrderWithPayment(h.em(), { adapter: 'removed_adapter' });
    const handler = new ReceivePaymentHandler(h.em, ...handlerPorts());

    const res = await handler.receive({ paymentId: payment.id, outcome: 'success' });
    expect(res.status).toBe('paid');
    const reloadedOrder = await h.em().findOne(Order, { id: order.id });
    expect(reloadedOrder!.status).toBe('paid');
  });
});
