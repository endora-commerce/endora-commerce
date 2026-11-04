import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { CommandBus } from './command-bus.js';
import { type Command } from './command.js';
import { EventBus, type EventBase } from '../events/bus.js';
import { type AuditPort, type RecordAuditInput } from '../kernel/ports/audit.js';
import {
  MissingTenantContextError,
  runWithTenantContext,
  runWithoutTenantContext,
  type TenantContext,
} from '../tenancy/tenant-context.js';

/**
 * Unit-level verification of the transactional composition (feature 054, FR-003).
 * A fake EM runs the transactional callback inline; a fake audit records calls; a
 * REAL EventBus verifies dispatch-on-commit / drop-on-throw. The DB-level
 * rollback-after-persist guarantee is covered by the integration test (T004).
 */
function makeHarness() {
  const auditCalls: RecordAuditInput[] = [];
  const fakeEm = {
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      return cb(fakeEm as unknown as EntityManager);
    },
  };
  const fakeOrm = { em: { fork: () => fakeEm } } as unknown as MikroORM;
  const fakeAudit = {
    recordWithin(_em: EntityManager, input: RecordAuditInput) {
      auditCalls.push(input);
      return {} as never;
    },
  } as unknown as AuditPort;
  const events = new EventBus<Record<string, EventBase>>();
  const dispatched: string[] = [];
  const bus = new CommandBus(fakeOrm, fakeAudit, events);
  return { bus, events, auditCalls, dispatched };
}

const adminCtx: TenantContext = { mode: 'all', actor: { kind: 'admin', id: 'admin-1' } };

describe('CommandBus.run (feature 054, FR-003)', () => {
  it('commits: records exactly one audit row and dispatches the event once, returning the result', async () => {
    const h = makeHarness();
    h.events.on('thing.updated', () => {
      h.dispatched.push('thing.updated');
    });

    const cmd: Command<{ id: string }> = {
      action: 'thing.update',
      objectType: 'thing',
      objectId: 't1',
      async capture() {
        return { name: 'old' };
      },
      async run() {
        return { result: { id: 't1' }, after: { name: 'new' } };
      },
      event() {
        return { eventName: 'thing.updated', payload: { eventId: 'e1', occurredAt: '2026-07-18' } };
      },
    };

    const result = await runWithTenantContext(adminCtx, () => h.bus.run(cmd));

    expect(result).toEqual({ id: 't1' });
    expect(h.auditCalls).toHaveLength(1);
    expect(h.auditCalls[0]).toMatchObject({
      action: 'thing.update',
      objectType: 'thing',
      objectId: 't1',
      actorAdminUserId: 'admin-1',
      impersonatedCustomerAccountId: null,
      stateBefore: { name: 'old' },
      stateAfter: { name: 'new' },
    });
    expect(h.dispatched).toEqual(['thing.updated']);
  });

  it('rolls back: a throwing run records no audit and dispatches no event', async () => {
    const h = makeHarness();
    h.events.on('thing.updated', () => {
      h.dispatched.push('thing.updated');
    });

    const cmd: Command = {
      action: 'thing.update',
      objectType: 'thing',
      objectId: 't1',
      async run() {
        throw new Error('boom');
      },
      event() {
        return { eventName: 'thing.updated', payload: { eventId: 'e1', occurredAt: '2026-07-18' } };
      },
    };

    await expect(runWithTenantContext(adminCtx, () => h.bus.run(cmd))).rejects.toThrow('boom');
    expect(h.auditCalls).toHaveLength(0);
    expect(h.dispatched).toEqual([]);
  });

  it('captures impersonation actor onto the audit row', async () => {
    const h = makeHarness();
    const impCtx: TenantContext = {
      mode: 'single-org',
      organizationId: 'org-1',
      customerAccountId: 'cust-1',
      actor: { kind: 'customer', id: 'cust-1' },
      impersonation: { realAdminUserId: 'admin-9', impersonatedCustomerAccountId: 'cust-1' },
    };
    const cmd: Command<null> = {
      action: 'thing.update',
      objectType: 'thing',
      objectId: 't1',
      async run() {
        return { result: null };
      },
    };
    await runWithTenantContext(impCtx, () => h.bus.run(cmd));
    expect(h.auditCalls[0]).toMatchObject({
      actorAdminUserId: 'admin-9',
      impersonatedCustomerAccountId: 'cust-1',
    });
  });

  it('fails closed: no ambient context throws before any write', async () => {
    const h = makeHarness();
    const cmd: Command<null> = {
      action: 'thing.update',
      objectType: 'thing',
      objectId: 't1',
      async run() {
        return { result: null };
      },
    };
    await runWithoutTenantContext(async () => {
      await expect(h.bus.run(cmd)).rejects.toThrow(MissingTenantContextError);
    });
    expect(h.auditCalls).toHaveLength(0);
  });
});

/**
 * A harness whose fake transaction behaves like one: an audit entry recorded
 * within it lands in `committed` only when the callback resolves, and is gone
 * when it throws. That is the property child Commands are about, so the
 * inline-callback fake above cannot prove it.
 */
function makeTransactionalHarness() {
  const committed: RecordAuditInput[] = [];
  let transactions = 0;
  const pendingOf = new WeakMap<object, RecordAuditInput[]>();
  const fakeEm = {
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      transactions += 1;
      const txEm = { id: transactions };
      const pending: RecordAuditInput[] = [];
      pendingOf.set(txEm, pending);
      const result = await cb(txEm as unknown as EntityManager);
      committed.push(...pending);
      return result;
    },
  };
  const fakeOrm = { em: { fork: () => fakeEm } } as unknown as MikroORM;
  const emsSeen: unknown[] = [];
  const fakeAudit = {
    recordWithin(em: EntityManager, input: RecordAuditInput) {
      emsSeen.push(em);
      const pending = pendingOf.get(em as unknown as object);
      if (!pending) throw new Error('recordWithin was handed an EntityManager with no open transaction');
      pending.push(input);
      return {} as never;
    },
  } as unknown as AuditPort;
  const events = new EventBus<Record<string, EventBase>>();
  const dispatched: string[] = [];
  const bus = new CommandBus(fakeOrm, fakeAudit, events);
  return { bus, events, committed, dispatched, emsSeen, transactions: () => transactions };
}

function leaf(
  action: string,
  options: { throws?: boolean; skipAudit?: boolean; event?: string; seen?: unknown[] } = {},
): Command<string> {
  return {
    action,
    objectType: 'thing',
    objectId: action,
    async run(ctx) {
      options.seen?.push(ctx);
      if (options.throws) throw new Error(`${action} failed`);
      return { result: action, after: { action }, ...(options.skipAudit ? { skipAudit: true } : {}) };
    },
    ...(options.event
      ? {
          event: () => ({
            eventName: options.event!,
            payload: { eventId: `${action}-event`, occurredAt: '2026-11-03' },
          }),
        }
      : {}),
  };
}

describe('CommandContext.run — child Commands in the parent transaction (feature 170, R-22, FR-065)', () => {
  it("records each child's own entry and the parent's, committing them together in one transaction", async () => {
    const h = makeTransactionalHarness();
    const seen: unknown[] = [];
    const parent: Command<string[]> = {
      action: 'parent.run',
      objectType: 'organization',
      objectId: 'org-1',
      async run(ctx) {
        seen.push(ctx);
        const a = await ctx.run!(leaf('child.a', { seen }));
        const b = await ctx.run!(leaf('child.b', { seen }));
        return { result: [a, b], after: { children: 2 } };
      },
    };

    const result = await runWithTenantContext(adminCtx, () => h.bus.run(parent));

    expect(result).toEqual(['child.a', 'child.b']);
    expect(h.transactions()).toBe(1);
    expect(h.committed.map((entry) => entry.action)).toEqual(['child.a', 'child.b', 'parent.run']);
    // Every entry names the same actor, derived once from the ambient context.
    for (const entry of h.committed) {
      expect(entry).toMatchObject({ actorAdminUserId: 'admin-1', impersonatedCustomerAccountId: null });
    }
    // The children ran on the parent's EntityManager and actor.
    const [parentCtx, childA, childB] = seen as Array<{ em: unknown; actor: unknown }>;
    expect(childA!.em).toBe(parentCtx!.em);
    expect(childB!.em).toBe(parentCtx!.em);
    expect(childA!.actor).toEqual(parentCtx!.actor);
    expect(new Set(h.emsSeen)).toEqual(new Set([parentCtx!.em]));
  });

  it("a throwing child rolls back the parent and every sibling's entry", async () => {
    const h = makeTransactionalHarness();
    const parent: Command<null> = {
      action: 'parent.run',
      objectType: 'organization',
      objectId: 'org-1',
      async run(ctx) {
        await ctx.run!(leaf('child.a'));
        await ctx.run!(leaf('child.b', { throws: true }));
        return { result: null };
      },
    };

    await expect(runWithTenantContext(adminCtx, () => h.bus.run(parent))).rejects.toThrow('child.b failed');
    expect(h.committed).toEqual([]);
  });

  it('a skipAudit child records nothing, and its siblings and parent still do', async () => {
    const h = makeTransactionalHarness();
    const parent: Command<null> = {
      action: 'parent.run',
      objectType: 'organization',
      objectId: 'org-1',
      async run(ctx) {
        await ctx.run!(leaf('child.noop', { skipAudit: true }));
        await ctx.run!(leaf('child.a'));
        return { result: null };
      },
    };

    await runWithTenantContext(adminCtx, () => h.bus.run(parent));
    expect(h.committed.map((entry) => entry.action)).toEqual(['child.a', 'parent.run']);
  });

  it("a child's event is buffered and dispatched once, on the parent's commit", async () => {
    const h = makeTransactionalHarness();
    const timeline: string[] = [];
    h.events.on('child.changed', () => {
      timeline.push('dispatched');
    });
    const parent: Command<null> = {
      action: 'parent.run',
      objectType: 'organization',
      objectId: 'org-1',
      async run(ctx) {
        await ctx.run!(leaf('child.a', { event: 'child.changed' }));
        timeline.push('child returned');
        return { result: null };
      },
    };

    await runWithTenantContext(adminCtx, () => h.bus.run(parent));
    expect(timeline).toEqual(['child returned', 'dispatched']);
  });

  it("a child's event is dropped when the parent throws after the child returned", async () => {
    const h = makeTransactionalHarness();
    h.events.on('child.changed', () => {
      h.dispatched.push('child.changed');
    });
    const parent: Command<null> = {
      action: 'parent.run',
      objectType: 'organization',
      objectId: 'org-1',
      async run(ctx) {
        await ctx.run!(leaf('child.a', { event: 'child.changed' }));
        throw new Error('parent failed');
      },
    };

    await expect(runWithTenantContext(adminCtx, () => h.bus.run(parent))).rejects.toThrow('parent failed');
    expect(h.dispatched).toEqual([]);
    expect(h.committed).toEqual([]);
  });

  it("captures a child's before-state on the parent's transaction", async () => {
    const h = makeTransactionalHarness();
    const child: Command<null> = {
      action: 'child.capture',
      objectType: 'thing',
      objectId: 't1',
      async capture() {
        return { before: true };
      },
      async run() {
        return { result: null, after: { before: false } };
      },
    };
    const parent: Command<null> = {
      action: 'parent.run',
      objectType: 'organization',
      objectId: 'org-1',
      async run(ctx) {
        await ctx.run!(child);
        return { result: null, skipAudit: true };
      },
    };

    await runWithTenantContext(adminCtx, () => h.bus.run(parent));
    expect(h.committed).toEqual([
      expect.objectContaining({ action: 'child.capture', stateBefore: { before: true }, stateAfter: { before: false } }),
    ]);
  });
});

describe('the customer actor on the audit row (feature 170, R-21, SC-006)', () => {
  it('a customer acting for themselves lands on actorCustomerAccountId', async () => {
    const h = makeHarness();
    const customerCtx: TenantContext = {
      mode: 'single-org',
      organizationId: 'org-1',
      customerAccountId: 'cust-3',
      actor: { kind: 'customer', id: 'cust-3' },
    };
    await runWithTenantContext(customerCtx, () => h.bus.run(leaf('thing.update')));
    expect(h.auditCalls[0]).toMatchObject({
      actorAdminUserId: null,
      impersonatedCustomerAccountId: null,
      actorCustomerAccountId: 'cust-3',
    });
  });

  it('impersonation fills the two impersonation fields and leaves actorCustomerAccountId null', async () => {
    const h = makeHarness();
    const impCtx: TenantContext = {
      mode: 'single-org',
      organizationId: 'org-1',
      customerAccountId: 'cust-1',
      actor: { kind: 'customer', id: 'cust-1' },
      impersonation: { realAdminUserId: 'admin-9', impersonatedCustomerAccountId: 'cust-1' },
    };
    await runWithTenantContext(impCtx, () => h.bus.run(leaf('thing.update')));
    expect(h.auditCalls[0]).toMatchObject({
      actorAdminUserId: 'admin-9',
      impersonatedCustomerAccountId: 'cust-1',
      actorCustomerAccountId: null,
    });
  });

  it('an administrator leaves actorCustomerAccountId null', async () => {
    const h = makeHarness();
    await runWithTenantContext(adminCtx, () => h.bus.run(leaf('thing.update')));
    expect(h.auditCalls[0]).toMatchObject({ actorAdminUserId: 'admin-1', actorCustomerAccountId: null });
  });
});
