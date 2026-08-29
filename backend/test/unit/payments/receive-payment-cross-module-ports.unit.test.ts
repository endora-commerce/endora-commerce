import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OrderTransitionOutcome,
  OrderTransitionPort,
  PaymentMethodReadPort,
  PaymentMethodRecord,
} from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import type { OrderPaymentStatusApplyPort } from '@endora-commerce/mod-orders/ports';
// `dist`, not `src`, and it is this file's central assertion that depends on it:
// `PAYMENTS_TRANSACTIONAL_ENTITIES` is a `Set` of entity **classes** and the fake
// `findOne` below decides membership by identity. `Payment` comes from the
// package's published `entities` array (`package-entities.ts`), so a handler
// built from the package's *source* would pass a second `Payment` class of the
// same name, the set would not contain it, and the test would report `payments`
// querying an entity it may not — a false red whose real cause is two copies.
import {
  ReceivePaymentHandler,
  type SettlementLogger,
} from '../../../../packages/modules/payments/dist/backend/services/receive-payment-handler.js';
import { PaymentMethod } from '../../helpers/package-entities.js';
import { Order } from '../../helpers/package-entities.js';
import { Payment } from '../../helpers/package-entities.js';

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
 * Feature 080, T048 — and the order write is the fourth. `Order` used to be the
 * one entity this fixture allowed through, on the ground that
 * `payments_order_fk` holds the payment row and the order's payment status
 * co-transactional (D-78 point 2) so a fixture refusing it would assert the
 * opposite of the ruling. D-169 settles that differently and without touching
 * the constraint: the seam keeps the caller's `EntityManager` and stops being
 * an entity class, because D-168 leaves a packaged `orders` no class for this
 * module to name. So the exception is **withdrawn** — this fixture now refuses
 * `Order` like every other module's entity, and the settlement reaches the
 * order only through `orderPaymentStatusApplyPort`, on the transaction it is
 * already holding.
 *
 * The `EntityManager` below therefore **refuses every entity except
 * `Payment`**. Every other module's entity — `PaymentMethod` and `Order` above
 * all — reads as "`payments` queried somebody else's table" and fails the test,
 * which is what makes the ports the only way either can arrive.
 */

const PAYMENTS_TRANSACTIONAL_ENTITIES = new Set<unknown>([Payment]);

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

/**
 * `orders`' side of the co-transactional seam, as a double that records the
 * `EntityManager` it was handed.
 *
 * The recorded `em` is the assertion that matters and the one no type can make:
 * the interface takes the caller's `EntityManager` as a *required* parameter
 * (D-169), and a settlement that passed anything other than its own transaction
 * would be writing the order on a connection its rollback cannot reach — the
 * shape `check:transaction-context` exists for.
 *
 * It also proves the return is a **record**: the double owns no `Order` and
 * hands back a plain object, so a handler that had gone on reading entity-only
 * members would not compile.
 */
function paymentStatusPort(
  rows: Rows,
  em: FakeEm,
): OrderPaymentStatusApplyPort & {
  calls: Array<{ orderId: string; paymentStatus: string; sameTx: boolean; afterCommit: boolean }>;
} {
  const calls: Array<{
    orderId: string;
    paymentStatus: string;
    sameTx: boolean;
    afterCommit: boolean;
  }> = [];
  return {
    calls,
    applyPaymentStatus: async (handed, input) => {
      calls.push({
        orderId: input.orderId,
        paymentStatus: input.paymentStatus,
        sameTx: (handed as unknown) === (em.emFactory() as unknown),
        afterCommit: em.committed,
      });
      if (rows.order.id !== input.orderId) return null;
      rows.order.paymentStatus = input.paymentStatus;
      return {
        orderId: rows.order.id,
        status: rows.order.status,
        paymentStatus: input.paymentStatus,
      };
    },
  };
}

/** An order the settlement's payment does not point at — the `null` answer. */
function noSuchOrder(): OrderPaymentStatusApplyPort {
  return { applyPaymentStatus: async () => null };
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
    const applyPort = paymentStatusPort(rows, em);
    const transition = transitionPort(em);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      transition,
      applyPort,
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
    const applyPort = paymentStatusPort(rows, em);
    const transition = transitionPort(em);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      transition,
      applyPort,
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
    const applyPort = paymentStatusPort(rows, em);
    const transition = transitionPort(em, { applied: true, from: 'new', to: 'on_hold' });
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      transition,
      applyPort,
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
    const applyPort = paymentStatusPort(rows, em);
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
      applyPort,
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
    const applyPort = paymentStatusPort(rows, em);
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
      applyPort,
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
    const applyPort = paymentStatusPort(rows, em);
    const transition = transitionPort(em);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord({ statusOnSuccess: '' })),
      transition,
      applyPort,
      recordingLog(),
    );

    const res = await handler.receive({ paymentId: 'pay-1', outcome: 'success' });

    expect(transition.asked).toHaveLength(0);
    expect(res.orderStatus).toBe('new');
  });

  it('fails closed with 503 MODULE_DISABLED, and writes nothing, when payment_methods is off', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const applyPort = paymentStatusPort(rows, em);
    const transition = transitionPort(em);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      switchedOff<PaymentMethodReadPort>('payment_methods'),
      transition,
      applyPort,
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
    const applyPort = paymentStatusPort(rows, em);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      switchedOff<OrderTransitionPort>('orders'),
      applyPort,
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
  /**
   * Feature 080, T048 — the property the whole conversion turns on, and the one
   * no type argument can make: the order write happens **on the settlement's own
   * `EntityManager`, before the commit**.
   *
   * `check:transaction-context` exists because `PromotionUsageService.finalize`
   * wrote on a pooled connection instead, so a cap hit rolled the order back and
   * left a redemption row pointing at an order that never existed. The same
   * mistake here would leave a payment `paid` against an order still awaiting
   * payment, with `payments_order_fk` — the constraint the seam is held by —
   * powerless to say so.
   */
  it('writes the order`s payment status on the settlement transaction, through the port, before the commit', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const applyPort = paymentStatusPort(rows, em);
    const transition = transitionPort(em);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      transition,
      applyPort,
      recordingLog(),
    );

    await handler.receive({ paymentId: 'pay-1', outcome: 'success' });

    expect(applyPort.calls).toEqual([
      { orderId: 'ord-1', paymentStatus: 'paid', sameTx: true, afterCommit: false },
    ]);
    // And the fixture's own refusal is what says the entity never travelled:
    // `Order` is no longer a member, so `tx.findOne(Order, …)` would have thrown.
    expect(PAYMENTS_TRANSACTIONAL_ENTITIES.has(Order)).toBe(false);
  });

  /**
   * The `null` answer is a state, not an error (see the port's own contract).
   * It replaces `if (order)` guards over a `findOne` that could miss, and the
   * settlement's behaviour is unchanged: the payment is recorded, the lifecycle
   * is still asked for the method's configured move, and `orderStatus` is null
   * because nothing observed one.
   */
  it('records the payment and reports no order status when the port answers null', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const transition = transitionPort(em);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      transition,
      noSuchOrder(),
      recordingLog(),
    );

    const res = await handler.receive({ paymentId: 'pay-1', outcome: 'success' });

    expect(res.status).toBe('paid');
    expect(rows.payment.status).toBe('paid');
    expect(res.orderStatus).toBe('paid');
    expect(rows.order.paymentStatus).toBe('awaiting_payment');
  });

  /**
   * The co-transactional half of the fail-closed obligation, and a different
   * assertion from the `orderTransitionPort` one below it: that port is called
   * after the commit and its refusal cannot undo a durable payment, while this
   * one is called **inside** the transaction, so a switched-off owner takes the
   * whole settlement with it and the payment row is left exactly as it was.
   *
   * `orders` declares `activation.nonDeactivatable`, so an operator cannot
   * reach this state by flipping a control — but a deployment may omit the
   * module (D-101), and the gate is the port registration's either way. What is
   * asserted here is therefore the substance the manifest forbids a
   * deactivation-consequence entry for: the seam refuses rather than
   * half-executing.
   */
  it('fails closed inside the settlement transaction when the order write`s owner is absent', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const transition = transitionPort(em);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      transition,
      switchedOff<OrderPaymentStatusApplyPort>('orders'),
      recordingLog(),
    );

    await expect(handler.receive({ paymentId: 'pay-1', outcome: 'success' })).rejects.toMatchObject({
      statusCode: 503,
      code: 'MODULE_DISABLED',
      details: { module: 'orders' },
    });

    // Nothing was flushed and nothing committed, which is what a rollback
    // reduces to here: the throw lands after this handler has assigned the
    // payment's in-memory fields, and in a real transaction those are exactly
    // the assignments the rollback discards. The fixture's `payment` is a plain
    // object with no unit of work behind it, so asserting its fields would be
    // asserting a property of the double rather than of the handler — the
    // `payment_methods` case above can, only because that port is read before
    // the first assignment.
    expect(em.flushes).toBe(0);
    expect(em.committed).toBe(false);
    expect(rows.order.paymentStatus).toBe('awaiting_payment');
    expect(rows.order.status).toBe('new');
    expect(transition.asked).toHaveLength(0);
  });

  /**
   * A partial refund asks the order nothing at all, which is the behaviour the
   * conversion had to preserve rather than the one it chose: the expression it
   * replaces was `Boolean(order) && input.fullyRefunded`, false on every partial
   * refund whether the order was there or not, so the read under it was doing no
   * work. Asking the port on a partial refund would be a write where there was
   * none.
   */
  it('asks the order nothing on a partial refund, and flips it on a full one', async () => {
    const partialRows = { payment: paymentRow(), order: orderRow() };
    partialRows.payment.status = 'paid';
    const partialEm = transactionalEm(partialRows);
    const partialPort = paymentStatusPort(partialRows, partialEm);
    const partial = new ReceivePaymentHandler(
      partialEm.emFactory,
      readPort(methodRecord()),
      transitionPort(partialEm),
      partialPort,
      recordingLog(),
    );

    await partial.reflectRefund({
      paymentId: 'pay-1',
      refundedAmount: 10,
      currency: 'PLN',
      fullyRefunded: false,
    });

    expect(partialPort.calls).toEqual([]);
    expect(partialRows.order.paymentStatus).toBe('awaiting_payment');

    const fullRows = { payment: paymentRow(), order: orderRow() };
    fullRows.payment.status = 'paid';
    const fullEm = transactionalEm(fullRows);
    const fullPort = paymentStatusPort(fullRows, fullEm);
    const fullTransition = transitionPort(fullEm, { applied: true, from: 'paid', to: 'on_hold' });
    const full = new ReceivePaymentHandler(
      fullEm.emFactory,
      readPort(methodRecord()),
      fullTransition,
      fullPort,
      recordingLog(),
    );

    await full.reflectRefund({
      paymentId: 'pay-1',
      refundedAmount: 123,
      currency: 'PLN',
      fullyRefunded: true,
    });

    expect(fullPort.calls).toEqual([
      { orderId: 'ord-1', paymentStatus: 'refunded', sameTx: true, afterCommit: false },
    ]);
    expect(fullRows.order.paymentStatus).toBe('refunded');
    // The hold still goes through the lifecycle, after the commit.
    expect(fullTransition.asked).toHaveLength(1);
    expect(fullTransition.asked[0]).toMatchObject({ to: 'on_hold', afterCommit: true });
  });
});
