import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OrderStatusAnnouncePort,
  OrderStatusRegistry,
  PaymentMethodReadPort,
} from '@b2b/contracts';
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
  /**
   * The two cross-module reads the handler makes, resolved off the composed
   * container rather than stubbed (feature 075, C-W3). They are gated ports, so
   * resolving them here is what the four gateways do through
   * `receivePaymentPort`, and a test that stubbed them would stop exercising the
   * seam it is here to keep honest.
   */
  const handlerPorts = (): [PaymentMethodReadPort, OrderStatusAnnouncePort] => [
    h.container.resolve<PaymentMethodReadPort>('paymentMethodReadPort'),
    h.container.resolve<OrderStatusAnnouncePort>('orderStatusAnnouncePort'),
  ];

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('marks the Payment paid and applies statusOnSuccess (T034)', async () => {
    const { order, payment } = await seedOrderWithPayment(h.em());
    const handler = new ReceivePaymentHandler(h.em, ...handlerPorts(), registry);

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
    const handler = new ReceivePaymentHandler(h.em, ...handlerPorts(), registry);

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
    const handler = new ReceivePaymentHandler(h.em, ...handlerPorts(), registry);

    await handler.receive({ paymentId: payment.id, outcome: 'success' });
    const again = await handler.receive({ paymentId: payment.id, outcome: 'success' });
    expect(again.idempotent).toBe(true);

    await expect(
      handler.receive({ paymentId: payment.id, outcome: 'failure', failureReason: 'late' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('opens a retry Payment after a failure, preserving prior attempts (T035)', async () => {
    const { order, payment } = await seedOrderWithPayment(h.em());
    const handler = new ReceivePaymentHandler(h.em, ...handlerPorts(), registry);
    const service = new PaymentService(h.em);

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
    const service = new PaymentService(h.em);

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
    const service = new PaymentService(h.em);

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
    const service = new PaymentService(h.em);

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
   * Feature 075, C-W3 — the payment row and the order status still commit or
   * roll back together after the payment-method read moved onto a port.
   *
   * The failure is placed at the **flush**, after `receive()` has already
   * stamped `payment.status = 'paid'` / `paidAt` and moved `order.status`: a
   * `statusOnSuccess` longer than `orders.status` (`varchar(64)`) is refused by
   * Postgres when the unit of work writes it. Nothing else in the handler can
   * fail that late, and a failure earlier than the mutations would prove only
   * that a write that never happened did not happen.
   *
   * The port is stubbed for exactly that one oversized field — the real
   * `paymentMethodReadPort` is what every other case here resolves — because
   * `payment_methods.status_on_success` is `varchar(64)` too, so the row cannot
   * be seeded with it.
   */
  it('rolls the payment back with the order when the settlement flush fails (C-W3)', async () => {
    const { method, order, payment } = await seedOrderWithPayment(h.em());
    const [, announce] = handlerPorts();
    const tooLongForTheColumn = 'x'.repeat(80);
    const oversized: PaymentMethodReadPort = {
      findById: async () => ({
        id: method.id,
        code: method.code,
        name: method.name,
        kind: method.kind,
        adapter: method.adapter,
        status: method.status,
        additionalPrice: method.additionalPrice,
        statusOnPending: method.statusOnPending,
        statusOnSuccess: tooLongForTheColumn,
        statusOnFailure: method.statusOnFailure,
        createdAt: method.createdAt,
        updatedAt: method.updatedAt,
      }),
      findByIds: async () => [],
      findByCode: async () => null,
      listAll: async () => [],
      listActive: async () => [],
    };
    // `has` is the guard the handler asks before it applies a status; saying yes
    // is what lets the oversized code reach the flush.
    const permissive = { has: () => true } as unknown as OrderStatusRegistry;
    const handler = new ReceivePaymentHandler(h.em, oversized, announce, permissive);

    // Asserted on the message, so the test cannot pass by failing *earlier*
    // than the writes it is here to roll back: this is Postgres refusing the
    // write, which only happens once the unit of work flushes both rows.
    await expect(handler.receive({ paymentId: payment.id, outcome: 'success' })).rejects.toThrow(
      /value too long for type character varying\(64\)/i,
    );

    const em = h.em();
    const reloadedPayment = await em.findOne(Payment, { id: payment.id }, { refresh: true });
    expect(reloadedPayment!.status).toBe('awaiting_payment');
    expect(reloadedPayment!.paidAt ?? null).toBeNull();
    const reloadedOrder = await em.findOne(Order, { id: order.id }, { refresh: true });
    expect(reloadedOrder!.status).toBe('new');
    expect(reloadedOrder!.paymentStatus).toBe('awaiting_payment');
  });

  it('reconciles a late receive even when the adapter is de-registered (T036a / R6)', async () => {
    // The method references an adapter key that is NOT in any registry; the
    // handler keys on the persisted Payment, so the late event still settles.
    const { order, payment } = await seedOrderWithPayment(h.em(), { adapter: 'removed_adapter' });
    const handler = new ReceivePaymentHandler(h.em, ...handlerPorts(), registry);

    const res = await handler.receive({ paymentId: payment.id, outcome: 'success' });
    expect(res.status).toBe('paid');
    const reloadedOrder = await h.em().findOne(Order, { id: order.id });
    expect(reloadedOrder!.status).toBe('completed');
  });
});
