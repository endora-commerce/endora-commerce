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
