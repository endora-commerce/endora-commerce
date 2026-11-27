/**
 * `specs/186-aggregate-ports/` T055 (issue #1823, US4) — the Order lifecycle
 * Commands on the **real** `CommandBus`, with a recording audit port and an
 * in-memory EntityManager: what each Command hands the bus (its action, its
 * audit state, `skipAudit`), its refusals, and that a refusal records nothing.
 * The locks, the rollback and the follow-up drain are measured against
 * PostgreSQL by `backend/test/contract/orders/order-command-port.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CommandBus } from '@endora-commerce/platform/commands';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { OrderComment } from '../entities/order-comment.entity.js';
import { Order } from '../entities/order.entity.js';
import { ORDER_AUDIT_KEYS, makeSetOrderCustomFieldValuesCommand } from '../services/order-audit-state.js';
import { withCallerOptions } from './caller-options.js';
import { makeOrderCommentAddCommand, ORDER_COMMENT_ADD_ACTION } from './order-comment-add.command.js';
import {
  makeOrderPaymentStatusTransitionCommand,
  ORDER_PAYMENT_STATUS_TRANSITION_ACTION,
} from './order-payment-status-transition.command.js';
import {
  makeOrderStatusTransitionCommand,
  ORDER_STATUS_TRANSITION_ACTION,
  OrderStatusMovedError,
} from './order-status-transition.command.js';

const ADMIN = '00000000-0000-4000-8000-0000000018a3';

type Row = Record<string, unknown>;

/** Enough of MikroORM's EntityManager for the four Commands, keyed by class name. */
class FakeEm {
  readonly tables = new Map<string, Row[]>();

  table(name: string): Row[] {
    let rows = this.tables.get(name);
    if (!rows) this.tables.set(name, (rows = []));
    return rows;
  }

  create<T extends object>(entity: new () => T, data: Partial<T>): T {
    const row = Object.assign(new entity(), data);
    this.table(entity.name).push(row as Row);
    return row;
  }

  persist(row: object): this {
    const rows = this.table(row.constructor.name);
    if (!rows.includes(row as Row)) rows.push(row as Row);
    return this;
  }

  async findOne(entity: { name: string }, where: Row): Promise<Row | null> {
    return this.table(entity.name).find((row) => Object.entries(where).every(([k, v]) => row[k] === v)) ?? null;
  }

  async flush(): Promise<void> {}

  async transactional<T>(fn: (em: FakeEm) => Promise<T>): Promise<T> {
    return fn(this);
  }

  fork(): this {
    return this;
  }
}

function harness() {
  const em = new FakeEm();
  const entries: RecordAuditInput[] = [];
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
    record: async () => {
      throw new Error('a Command records through recordWithin');
    },
  };
  const events = { run: async <T>(fn: () => Promise<T>) => fn(), emit: vi.fn() };
  const commandBus = new CommandBus({ em } as never, audit as never, events as never);
  const effects = { record: vi.fn(async () => 1) };
  return { em, entries, commandBus, effects };
}

function seedOrder(em: FakeEm, over: Partial<Order> = {}): Order {
  return em.create(Order, {
    id: randomUUID(),
    businessId: 'ORD-001823',
    organizationId: randomUUID(),
    placedByCustomerAccountId: randomUUID(),
    status: 'new',
    paymentStatus: 'awaiting_payment',
    paymentMethodSnapshot: { code: 'credit', name: 'Credit', kind: 'credit_limit' },
    customFieldValues: {},
    ...over,
  } as Partial<Order>);
}

const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScopeActingFor(ADMIN, 'orders command test', fn);
const asWorker = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('orders command test', fn);

const auditKeys = (entries: readonly RecordAuditInput[]): string[] => [
  ...new Set(entries.flatMap((e) => [...Object.keys(e.stateBefore ?? {}), ...Object.keys(e.stateAfter ?? {})])),
];

async function refusal(
  promise: Promise<unknown>,
): Promise<{ statusCode: number | undefined; code: string | undefined; error: unknown }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { statusCode?: number; code?: string };
    return { statusCode: e.statusCode, code: e.code, error };
  }
  throw new Error('expected a refusal');
}

describe('order.status_transition (186 US4)', () => {
  it('writes the status, stamps no other column, and records { status } before and after', async () => {
    const h = harness();
    const order = seedOrder(h.em);

    const result = await asAdmin(() =>
      h.commandBus.run(makeOrderStatusTransitionCommand({ effects: h.effects }, { orderId: order.id, from: 'new', to: 'paid' })),
    );

    expect(result.status).toBe('paid');
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({
      action: ORDER_STATUS_TRANSITION_ACTION,
      objectType: 'order',
      objectId: order.id,
      actorAdminUserId: ADMIN,
      stateBefore: { status: 'new' },
      stateAfter: { status: 'paid' },
    });
    expect(h.effects.record).not.toHaveBeenCalled();
  });

  it('records the follow-ups a cancellation owes on the same transaction', async () => {
    const h = harness();
    const order = seedOrder(h.em);

    await asWorker(() =>
      h.commandBus.run(
        makeOrderStatusTransitionCommand({ effects: h.effects }, { orderId: order.id, from: 'new', to: 'cancelled' }),
      ),
    );

    expect(h.effects.record).toHaveBeenCalledTimes(1);
    const [, , owed, origin] = h.effects.record.mock.calls[0] as unknown as [unknown, unknown, Array<{ effect: string }>, string];
    expect(owed.map((o) => o.effect)).toEqual(['stock.release', 'credit.release']);
    expect(origin).toBe('transition');
    // A worker's write records the system actor.
    expect(h.entries[0]?.actorAdminUserId ?? null).toBeNull();
  });

  it('stamps completedAt on the first entry into completed only', async () => {
    const h = harness();
    const order = seedOrder(h.em, { status: 'shipment_sent' } as Partial<Order>);

    await asAdmin(() =>
      h.commandBus.run(
        makeOrderStatusTransitionCommand({ effects: h.effects }, { orderId: order.id, from: 'shipment_sent', to: 'completed' }),
      ),
    );

    expect(order.completedAt).toBeInstanceOf(Date);
  });

  it('refuses an order that moved since the caller read it, recording nothing', async () => {
    const h = harness();
    const order = seedOrder(h.em, { status: 'processing' } as Partial<Order>);

    const { error } = await refusal(
      asAdmin(() =>
        h.commandBus.run(makeOrderStatusTransitionCommand({ effects: h.effects }, { orderId: order.id, from: 'new', to: 'paid' })),
      ),
    );

    expect(error).toBeInstanceOf(OrderStatusMovedError);
    expect(order.status).toBe('processing');
    expect(h.entries).toHaveLength(0);
  });

  it('refuses a transition that owes a follow-up when there is nowhere to record it', async () => {
    const h = harness();
    const order = seedOrder(h.em);

    await refusal(
      asAdmin(() =>
        h.commandBus.run(makeOrderStatusTransitionCommand({}, { orderId: order.id, from: 'new', to: 'cancelled' })),
      ),
    );

    expect(h.entries).toHaveLength(0);
  });

  it('answers 404 for an order the caller cannot see', async () => {
    const h = harness();

    const { statusCode, code } = await refusal(
      asAdmin(() =>
        h.commandBus.run(makeOrderStatusTransitionCommand({ effects: h.effects }, { orderId: randomUUID(), from: 'new', to: 'paid' })),
      ),
    );

    expect({ statusCode, code }).toEqual({ statusCode: 404, code: 'ORDER_NOT_FOUND' });
    expect(h.entries).toHaveLength(0);
  });

  it('records a port caller’s source code beside the system actor', async () => {
    const h = harness();
    const order = seedOrder(h.em);

    await asWorker(() =>
      h.commandBus.run(
        withCallerOptions(
          makeOrderStatusTransitionCommand({ effects: h.effects }, { orderId: order.id, from: 'new', to: 'paid' }),
          { source: 'payment' },
        ),
      ),
    );

    expect(h.entries[0]?.stateAfter).toEqual({ status: 'paid', source: 'payment' });
    expect(auditKeys(h.entries).filter((key) => !ORDER_AUDIT_KEYS.has(key))).toEqual([]);
  });
});

describe('order.payment_status_transition (186 US4)', () => {
  it('moves an operator edge, records { paymentStatus }, and the credit release it owes', async () => {
    const h = harness();
    const order = seedOrder(h.em);

    const { owes } = await asAdmin(() =>
      h.commandBus.run(makeOrderPaymentStatusTransitionCommand({ effects: h.effects }, { orderId: order.id, to: 'paid' })),
    );

    expect(order.paymentStatus).toBe('paid');
    expect(owes).toBe(true);
    expect(h.effects.record).toHaveBeenCalledTimes(1);
    expect(h.entries).toEqual([
      expect.objectContaining({
        action: ORDER_PAYMENT_STATUS_TRANSITION_ACTION,
        objectId: order.id,
        stateBefore: { paymentStatus: 'awaiting_payment' },
        stateAfter: { paymentStatus: 'paid' },
      }),
    ]);
  });

  it('records nothing, and owes nothing, for an order already there', async () => {
    const h = harness();
    const order = seedOrder(h.em, { paymentStatus: 'paid' } as Partial<Order>);

    const { owes } = await asAdmin(() =>
      h.commandBus.run(makeOrderPaymentStatusTransitionCommand({ effects: h.effects }, { orderId: order.id, to: 'paid' })),
    );

    expect(owes).toBe(false);
    expect(h.effects.record).not.toHaveBeenCalled();
    expect(h.entries).toHaveLength(0);
  });

  it('refuses a move that is not an operator edge with 409, writing nothing', async () => {
    const h = harness();
    const order = seedOrder(h.em);

    const { statusCode, code } = await refusal(
      asAdmin(() =>
        h.commandBus.run(makeOrderPaymentStatusTransitionCommand({ effects: h.effects }, { orderId: order.id, to: 'refunded' })),
      ),
    );

    expect({ statusCode, code }).toEqual({ statusCode: 409, code: 'ORDER_PAYMENT_STATUS_TRANSITION_NOT_ALLOWED' });
    expect(order.paymentStatus).toBe('awaiting_payment');
    expect(h.entries).toHaveLength(0);
  });
});

describe('order.comment.add (186 US4)', () => {
  const openGraph = { loadGraph: async () => ({ isTerminal: (code: string) => code === 'cancelled' }) as never };

  it('records the comment’s id and flags, never its body', async () => {
    const h = harness();
    const order = seedOrder(h.em);

    const { comment } = await asAdmin(() =>
      h.commandBus.run(
        makeOrderCommentAddCommand(
          { graph: openGraph },
          {
            orderId: order.id,
            authorAdminUserId: ADMIN,
            authorCustomerAccountId: null,
            body: 'S1823-COMMENT-BODY',
            isCustomerVisible: true,
            notifyCustomer: true,
          },
        ),
      ),
    );

    expect(comment).toBeInstanceOf(OrderComment);
    expect(h.entries).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({
      action: ORDER_COMMENT_ADD_ACTION,
      objectType: 'order',
      objectId: order.id,
      stateBefore: null,
      stateAfter: { commentId: comment.id, isCustomerVisible: true, notifyCustomer: true },
    });
    expect(JSON.stringify(h.entries)).not.toContain('S1823-COMMENT-BODY');
    expect(auditKeys(h.entries).filter((key) => !ORDER_AUDIT_KEYS.has(key))).toEqual([]);
  });

  it('refuses a terminal order with 409 ORDER_COMMENTS_CLOSED, writing nothing', async () => {
    const h = harness();
    const order = seedOrder(h.em, { status: 'cancelled' } as Partial<Order>);

    const { statusCode, code } = await refusal(
      asAdmin(() =>
        h.commandBus.run(
          makeOrderCommentAddCommand(
            { graph: openGraph },
            {
              orderId: order.id,
              authorAdminUserId: ADMIN,
              authorCustomerAccountId: null,
              body: 'late',
              isCustomerVisible: false,
              notifyCustomer: false,
            },
          ),
        ),
      ),
    );

    expect({ statusCode, code }).toEqual({ statusCode: 409, code: 'ORDER_COMMENTS_CLOSED' });
    expect(h.em.table('OrderComment')).toHaveLength(0);
    expect(h.entries).toHaveLength(0);
  });

  it('answers 404 for a malformed or unknown order id', async () => {
    const h = harness();
    for (const orderId of ['not-a-uuid', randomUUID()]) {
      const { statusCode } = await refusal(
        asAdmin(() =>
          h.commandBus.run(
            makeOrderCommentAddCommand(
              { graph: openGraph },
              { orderId, authorAdminUserId: null, authorCustomerAccountId: null, body: 'x', isCustomerVisible: false, notifyCustomer: false },
            ),
          ),
        ),
      );
      expect(statusCode).toBe(404);
    }
    expect(h.entries).toHaveLength(0);
  });
});

describe('order.custom_fields.update over a merge (186 US4)', () => {
  it('stores the merge’s answer over the locked bag and names the changed keys', async () => {
    const h = harness();
    const order = seedOrder(h.em, { customFieldValues: { kept: 'a', changed: 'b' } } as Partial<Order>);

    await asWorker(() =>
      h.commandBus.run(
        makeSetOrderCustomFieldValuesCommand({
          orderId: order.id,
          merge: async (current) => ({ ...current, changed: 'c', added: 'd' }),
        }),
      ),
    );

    expect(order.customFieldValues).toEqual({ kept: 'a', changed: 'c', added: 'd' });
    expect(h.entries[0]?.stateAfter).toEqual({ changedCustomFields: ['added', 'changed'] });
  });

  it('propagates a refusal the merge throws, recording nothing', async () => {
    const h = harness();
    const order = seedOrder(h.em);
    const refused = new Error('invalid');

    const { error } = await refusal(
      asWorker(() =>
        h.commandBus.run(
          makeSetOrderCustomFieldValuesCommand({
            orderId: order.id,
            merge: async () => {
              throw refused;
            },
          }),
        ),
      ),
    );

    expect(error).toBe(refused);
    expect(h.entries).toHaveLength(0);
  });
});
