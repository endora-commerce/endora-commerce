import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OrderStatusAnnouncePort,
  OrderStatusChange,
  OrderStatusRegistry,
  PaymentMethodReadPort,
  PaymentMethodRecord,
} from '@b2b/contracts';
import { describe, expect, it } from 'vitest';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { Payment } from '../../../src/modules/payments/entities/payment.entity.js';
import { ReceivePaymentHandler } from '../../../src/modules/payments/services/receive-payment-handler.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';

/**
 * Feature 075, C-W3 — the two cross-module reads `receive-payment-handler.ts`
 * used to make with somebody else's entity now go through their owner's port,
 * and this is the off-state obligation for both edges.
 *
 * The `EntityManager` below **refuses every entity except `Payment` and
 * `Order`**. `Order` is the one exception on purpose: `payments_order_fk` holds
 * it co-transactional and D-78 point 2 keeps that import permanently, so a
 * fixture that refused it would be asserting the opposite of the ruling. Every
 * other module's entity — `PaymentMethod` above all — reads as "`payments`
 * queried somebody else's table" and fails the test, which is what makes the
 * ports the only way the payment method can arrive.
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

function methodRecord(): PaymentMethodRecord {
  return {
    id: 'pm-1',
    code: 'bank',
    name: { default: 'Bank' },
    kind: 'bank_transfer',
    adapter: 'bank_transfer',
    status: 'active',
    additionalPrice: '0.00',
    statusOnPending: 'new',
    statusOnSuccess: 'completed',
    statusOnFailure: 'cancelled',
    createdAt: new Date(),
    updatedAt: new Date(),
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

const anyStatus: OrderStatusRegistry = { has: () => true } as unknown as OrderStatusRegistry;

function readPort(record: PaymentMethodRecord | null): PaymentMethodReadPort {
  return {
    findById: async () => record,
    findByIds: async () => (record ? [record] : []),
    findByCode: async () => record,
    listAll: async () => (record ? [record] : []),
    listActive: async () => (record ? [record] : []),
  };
}

function recordingAnnounce(): OrderStatusAnnouncePort & { changes: OrderStatusChange[] } {
  const changes: OrderStatusChange[] = [];
  return {
    changes,
    announceStatusChanged: (change) => {
      changes.push(change);
    },
  };
}

describe('ReceivePaymentHandler cross-module ports (feature 075, C-W3)', () => {
  it('reads the payment method through the port, never through the EntityManager', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const announce = recordingAnnounce();
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      announce,
      anyStatus,
    );

    const res = await handler.receive({ paymentId: 'pay-1', outcome: 'success' });

    // The fixture throws on `PaymentMethod`, so reaching 'completed' proves the
    // status came out of `paymentMethodReadPort` and not out of the table.
    expect(PAYMENTS_TRANSACTIONAL_ENTITIES.has(PaymentMethod)).toBe(false);
    expect(res.status).toBe('paid');
    expect(rows.order.status).toBe('completed');
    expect(rows.order.paymentStatus).toBe('paid');
  });

  it('announces the committed status change through the port, with the transition', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const announce = recordingAnnounce();
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      announce,
      anyStatus,
      // The announcement is gated on there being an event bus at all, as the
      // `payment.received.v1` emission it travels with is.
      { emit: () => {} } as never,
    );

    await handler.receive({ paymentId: 'pay-1', outcome: 'success' });

    expect(announce.changes).toEqual([
      {
        orderId: 'ord-1',
        organizationId: 'org-1',
        salesChannelId: 'chan-1',
        from: 'new',
        to: 'completed',
        actor: { kind: 'system', source: 'payment' },
      },
    ]);
  });

  it('fails closed with 503 MODULE_DISABLED, and writes nothing, when payment_methods is off', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const announce = recordingAnnounce();
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      switchedOff<PaymentMethodReadPort>('payment_methods'),
      announce,
      anyStatus,
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
    expect(announce.changes).toHaveLength(0);
  });

  it('fails closed with 503 MODULE_DISABLED when orders is off, after the settlement has committed', async () => {
    const rows = { payment: paymentRow(), order: orderRow() };
    const em = transactionalEm(rows);
    const handler = new ReceivePaymentHandler(
      em.emFactory,
      readPort(methodRecord()),
      switchedOff<OrderStatusAnnouncePort>('orders'),
      anyStatus,
      { emit: () => {} } as never,
    );

    await expect(handler.receive({ paymentId: 'pay-1', outcome: 'success' })).rejects.toMatchObject({
      statusCode: 503,
      code: 'MODULE_DISABLED',
      details: { module: 'orders' },
    });

    // And this half is deliberate, not an oversight: the announcement is made
    // **after** the commit, over a status change that is already durable, so it
    // has nothing to roll back and must not pretend otherwise. The gateway sees
    // a non-2xx and retries; the retry hits the idempotent branch (`paid`
    // already), announces nothing and answers 200.
    expect(em.committed).toBe(true);
    expect(rows.payment.status).toBe('paid');
    expect(rows.order.status).toBe('completed');
  });
});
