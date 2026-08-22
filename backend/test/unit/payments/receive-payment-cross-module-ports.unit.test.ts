import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OrderTransitionOutcome,
  OrderTransitionPort,
  PaymentMethodReadPort,
  PaymentMethodRecord,
} from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';
import {
  ReceivePaymentHandler,
  type SettlementLogger,
} from '../../../src/modules/payments/services/receive-payment-handler.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';

/**
 * Feature 075, C-W3 — the two cross-module reads `receive-payment-handler.ts`
 * used to make with somebody else's entity now go through their owner's port,
 * and this is the off-state obligation for both edges.
 *
 * Feature 085 Phase D — and the lifecycle write is the third. The cases below
 * assert the two properties that make the port call correct rather than merely
 * present: it happens **after** the settlement transaction has committed, and
 * the order's status is never assigned inside it.
 *
 * The `EntityManager` below **refuses every entity except `Payment` and
 * `Order`**. `Order` is the one exception on purpose: `payments_order_fk` holds
 * the payment row and the order's payment status co-transactional and D-78
 * point 2 keeps that import permanently, so a fixture that refused it would be
 * asserting the opposite of the ruling. Every other module's entity —
 * `PaymentMethod` above all — reads as "`payments` queried somebody else's
 * table" and fails the test, which is what makes the ports the only way the
 * payment method can arrive.
 */

const PAYMENTS_TRANSACTIONAL_ENTITIES = new Set<unknown>([Payment, Order]);

interface Rows {
  payment: Payment;
  order: Order;
}

interface FakeEm {
  emFactory: () => EntityManager;
  flushes: number;
  committed: boolean;
}

function transactionalEm(rows: Rows): FakeEm {
  const state: FakeEm = {
    emFactory: () => tx as unknown as EntityManager,
    flushes: 0,
    committed: false,
  };
  const refuse = (entity: unknown): never => {
    throw new Error(
      `payments queried an entity it may not: ${String(
        (entity as { name?: string }).name ?? entity,
      )}`,
    );
  };
  const tx = {
    findOne: async (entity: unknown) => {
      if (!PAYMENTS_TRANSACTIONAL_ENTITIES.has(entity)) refuse(entity);
      return entity === Payment ? rows.payment : rows.order;
    },
    flush: async () => {
      state.flushes += 1;
    },
    getKnex: () => refuse('knex'),
    getConnection: () => refuse('connection'),
    execute: async () => refuse('raw sql'),
    // The real `em.transactional` commits when the callback returns and rolls
    // back when it throws; `committed` is the observable half of that.
    transactional: async <T>(cb: (tx: EntityManager) => Promise<T>): Promise<T> => {
      const out = await cb(tx as unknown as EntityManager);
      state.committed = true;
      return out;
    },
  };
  return state;
}

function paymentRow(): Payment {
  return {
    id: 'pay-1',
    orderId: 'ord-1',
    paymentMethodId: 'pm-1',
    status: 'awaiting_payment',
    amount: '123.00',
    refundedAmount: '0',
    currency: 'PLN',
    attemptNo: 1,
    paidAt: null,
    externalReference: null,
  } as unknown as Payment;
}

function orderRow(): Order {
  return {
    id: 'ord-1',
    organizationId: 'org-1',
    salesChannelId: 'chan-1',
    status: 'new',
    paymentStatus: 'awaiting_payment',
  } as unknown as Order;
}

function methodRecord(over: Partial<PaymentMethodRecord> = {}): PaymentMethodRecord {
  return {
    id: 'pm-1',
    code: 'bank',
    name: { default: 'Bank' },
    kind: 'bank_transfer',
    adapter: 'bank_transfer',
    status: 'active',
    additionalPrice: '0.00',
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'on_hold',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

/** A port whose owner an operator has switched off. */
function switchedOff<T extends object>(moduleId: string): T {
  return new Proxy({} as T, {
    get: () => () => {
      throw new ModuleDisabledError(moduleId);
    },
  });
}

function readPort(record: PaymentMethodRecord | null): PaymentMethodReadPort {
  return {
    findById: async () => record,
    findByIds: async () => (record ? [record] : []),
    findByCode: async () => record,
    listAll: async () => (record ? [record] : []),
    listActive: async () => (record ? [record] : []),
  };
}

interface AskedFor {
  orderId: string;
  to: string;
  reason: string | null | undefined;
  actor: unknown;
  /**
   * Whether the settlement transaction had already committed when the port was
   * called. This is the assertion the whole ordering rule reduces to: the port
   * takes its own `EntityManager`, so a call made while `committed` is false
   * would be writing the order on a connection the caller's rollback cannot
   * reach (issue #200).
   */
  afterCommit: boolean;
}

function transitionPort(
  em: FakeEm,
  answer: OrderTransitionOutcome = { applied: true, from: 'new', to: 'paid' },
): OrderTransitionPort & { asked: AskedFor[] } {
  const asked: AskedFor[] = [];
  return {
    asked,
    applyStatus: async (input) => {
      asked.push({
        orderId: input.orderId,
        to: input.to,
        reason: input.reason,
        actor: input.actor,
        afterCommit: em.committed,
      });
      return answer;
    },
    isTerminal: async () => false,
  };
}

function recordingLog(): SettlementLogger & {
  warnings: Array<{ details: object; message: string }>;
} {
  const warnings: Array<{ details: object; message: string }> = [];
  return {
    warnings,
    warn: (details, message) => {
      warnings.push({ details, message });
    },
  };
}

describe('ReceivePaymentHandler cross-module ports (feature 075 C-W3, feature 085 Phase D)', () => {
  it('reads the payment method through the port, never through the EntityManager', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const transition = transitionPort(em);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      transition,
      recordingLog(),
    );

    const res = await handler.receive({ paymentId: 'pay-1', outcome: 'success' });

    // The fixture throws on `PaymentMethod`, so a target of 'paid' reaching the
    // transition port proves the status came out of `paymentMethodReadPort` and
    // not out of the table.
    expect(PAYMENTS_TRANSACTIONAL_ENTITIES.has(PaymentMethod)).toBe(false);
    expect(res.status).toBe('paid');
    expect(transition.asked.map((a) => a.to)).toEqual(['paid']);
    expect(rows.order.paymentStatus).toBe('paid');
  });

  /**
   * The ordering rule the port's contract states, asserted as a property of
   * this handler rather than trusted: the lifecycle move is asked for after the
   * commit. `OrderTransitionService` obtains its own `EntityManager`, so a call
   * from inside `em.transactional` would write the order on a second pooled
   * connection that commits independently — the shape
   * `check:transaction-context` refuses, and one no type error would reveal.
   */
  it('asks for the transition after the commit, and writes no status inside it', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const transition = transitionPort(em);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      transition,
      recordingLog(),
    );

    const res = await handler.receive({ paymentId: 'pay-1', outcome: 'success' });

    expect(transition.asked).toHaveLength(1);
    expect(transition.asked[0]).toMatchObject({
      orderId: 'ord-1',
      to: 'paid',
      actor: { kind: 'system', source: 'payment' },
      afterCommit: true,
    });
    // The order entity the transaction loaded carries the money axis and
    // nothing else: `order.status` is the lifecycle's to write, through the
    // port, on its own EntityManager.
    expect(rows.order.status).toBe('new');
    expect(res.orderStatus).toBe('paid');
  });

  it('carries the decline reason and the failure target on a failed payment', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const transition = transitionPort(em, { applied: true, from: 'new', to: 'on_hold' });
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      transition,
      recordingLog(),
    );

    const res = await handler.receive({
      paymentId: 'pay-1',
      outcome: 'failure',
      failureReason: 'card declined',
    });

    expect(rows.order.paymentStatus).toBe('failed');
    expect(transition.asked[0]).toMatchObject({
      to: 'on_hold',
      reason: 'card declined',
      afterCommit: true,
    });
    expect(res.orderStatus).toBe('on_hold');
  });

  /**
   * A refusal is an outcome, not an exception, and the settlement stands: the
   * provider is answered successfully whatever the lifecycle decided, because a
   * non-2xx callback is retried indefinitely. What must not happen is silence —
   * the refusal is recorded with the order, both statuses and the setting that
   * asked for the move.
   */
  it('keeps the order where it is when the lifecycle refuses, and records why', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const transition = transitionPort(em, {
      applied: false,
      reason: 'not_permitted',
      from: 'processing',
      detail: 'The configured lifecycle has no edge from "processing" to "paid".',
    });
    const log = recordingLog();
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      transition,
      log,
    );

    const res = await handler.receive({ paymentId: 'pay-1', outcome: 'success' });

    // The payment settled — that half is not in question and must not be undone.
    expect(res.status).toBe('paid');
    expect(rows.payment.status).toBe('paid');
    expect(res.orderStatus).toBe('processing');
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]?.details).toMatchObject({
      orderId: 'ord-1',
      from: 'processing',
      to: 'paid',
      setting: 'status_on_success',
      refusal: 'not_permitted',
    });
  });

  /**
   * A second decline on an order already at the failure status (FR-006). The
   * attempt is recorded, nothing moves, and nothing is logged: `already_there`
   * is not a refusal, it is the requested state.
   */
  it('says nothing when the order is already where the settlement wanted it', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const transition = transitionPort(em, {
      applied: false,
      reason: 'already_there',
      from: 'on_hold',
    });
    const log = recordingLog();
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      transition,
      log,
    );

    const res = await handler.receive({
      paymentId: 'pay-1',
      outcome: 'failure',
      failureReason: 'declined again',
    });

    expect(res.orderStatus).toBe('on_hold');
    expect(log.warnings).toHaveLength(0);
  });

  it('asks for no transition at all when the method configures no status', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const transition = transitionPort(em);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord({ statusOnSuccess: '' })),
      transition,
      recordingLog(),
    );

    const res = await handler.receive({ paymentId: 'pay-1', outcome: 'success' });

    expect(transition.asked).toHaveLength(0);
    expect(res.orderStatus).toBe('new');
  });

  it('fails closed with 503 MODULE_DISABLED, and writes nothing, when payment_methods is off', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const transition = transitionPort(em);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      switchedOff<PaymentMethodReadPort>('payment_methods'),
      transition,
      recordingLog(),
    );

    await expect(handler.receive({ paymentId: 'pay-1', outcome: 'success' })).rejects.toMatchObject({
      statusCode: 503,
      code: 'MODULE_DISABLED',
      details: { module: 'payment_methods' },
    });

    // The read is inside the settlement transaction, so a switched-off owner
    // aborts it: no flush, no commit, and the two rows are as they were.
    expect(em.flushes).toBe(0);
    expect(em.committed).toBe(false);
    expect(rows.payment.status).toBe('awaiting_payment');
    expect(rows.order.status).toBe('new');
    expect(rows.order.paymentStatus).toBe('awaiting_payment');
    expect(transition.asked).toHaveLength(0);
  });

  it('fails closed with 503 MODULE_DISABLED when orders is off, after the settlement has committed', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      switchedOff<OrderTransitionPort>('orders'),
      recordingLog(),
      { emit: () => {} } as never,
    );

    await expect(handler.receive({ paymentId: 'pay-1', outcome: 'success' })).rejects.toMatchObject({
      statusCode: 503,
      code: 'MODULE_DISABLED',
      details: { module: 'orders' },
    });

    // And this half is deliberate, not an oversight: the transition is asked
    // for **after** the commit, over a payment that is already durable, so it
    // has nothing to roll back and must not pretend otherwise. The gateway sees
    // a non-2xx and retries; the retry hits the idempotent branch (`paid`
    // already) and answers 200 without asking for a transition at all.
    //
    // The throw is not caught in the handler, and must not be: a bare `catch`
    // would read "the owner is absent" as "the lifecycle declined", which is
    // the fail-closed → fail-open turn `check:port-catches` refuses.
    expect(em.committed).toBe(true);
    expect(rows.payment.status).toBe('paid');
    expect(rows.order.paymentStatus).toBe('paid');
    expect(rows.order.status).toBe('new');
  });
});
