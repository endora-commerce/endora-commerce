import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { RequestMeta } from '@endora-commerce/contracts';
import { CommandBus } from './command-bus.js';
import { type Command } from './command.js';
import { EventBus, type EventBase } from '../events/bus.js';
import { type AuditPort, type RecordAuditInput } from '../kernel/ports/audit.js';
import { createRootContainer } from '../kernel/container.js';
import { enterPlatformScope } from '../kernel/scope.js';
import { runWithTenantContext, type TenantContext } from '../tenancy/tenant-context.js';

/**
 * Issue #997 — the request metadata a bus-written audit entry carries.
 *
 * The bus is constructed exactly as both composition roots construct it — with
 * no options — and must read the IP, user agent and request id of the request
 * in flight from the ambient platform scope. Outside a request (a worker, a
 * CLI script, a boot reconciler) the entry carries none of them, and never the
 * values of another request that is, or was, in flight.
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
  const bus = new CommandBus(fakeOrm, fakeAudit, new EventBus<Record<string, EventBase>>());
  return { bus, auditCalls };
}

const adminCtx: TenantContext = { mode: 'all', actor: { kind: 'admin', id: 'admin-1' } };

/** A command whose `run` awaits `gate` first, so two runs can be interleaved. */
function command(objectId: string, gate: Promise<void> = Promise.resolve()): Command<void> {
  return {
    action: 'thing.update',
    objectType: 'thing',
    objectId,
    async run() {
      await gate;
      return { result: undefined, after: { ok: true } };
    },
  };
}

const requestA: RequestMeta = { ipAddress: '203.0.113.10', userAgent: 'agent-a', requestId: 'req_a' };
const requestB: RequestMeta = { ipAddress: '198.51.100.20', userAgent: 'agent-b', requestId: 'req_b' };

function fieldsOf(entry: RecordAuditInput | undefined) {
  return {
    ipAddress: entry?.ipAddress,
    userAgent: entry?.userAgent,
    requestId: entry?.requestId,
  };
}

function inRequest<T>(meta: RequestMeta, run: () => Promise<T>): Promise<T> {
  return enterPlatformScope(adminCtx, run, {
    entryPoint: 'http',
    requestMeta: meta,
    container: createRootContainer(),
  });
}

describe('CommandBus — request metadata on the audit entry (issue #997)', () => {
  it('stamps the IP, user agent and request id of the request in flight', async () => {
    const h = makeHarness();

    await inRequest(requestA, () => h.bus.run(command('t1')));

    expect(h.auditCalls).toHaveLength(1);
    expect(fieldsOf(h.auditCalls[0])).toEqual({
      ipAddress: '203.0.113.10',
      userAgent: 'agent-a',
      requestId: 'req_a',
    });
  });

  it('keeps two interleaved requests apart: each entry carries its own request', async () => {
    const h = makeHarness();
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    // A starts first and parks inside its command; B then runs to completion;
    // only then does A resume and record its entry.
    const a = inRequest(requestA, () => h.bus.run(command('a', gateA)));
    await inRequest(requestB, () => h.bus.run(command('b')));
    releaseA();
    await a;

    const byObject = new Map(h.auditCalls.map((entry) => [entry.objectId, entry]));
    expect(h.auditCalls.map((entry) => entry.objectId)).toEqual(['b', 'a']);
    expect(fieldsOf(byObject.get('a'))).toEqual({
      ipAddress: '203.0.113.10',
      userAgent: 'agent-a',
      requestId: 'req_a',
    });
    expect(fieldsOf(byObject.get('b'))).toEqual({
      ipAddress: '198.51.100.20',
      userAgent: 'agent-b',
      requestId: 'req_b',
    });
  });

  it('records no request fields for a worker run after a request', async () => {
    const h = makeHarness();

    await inRequest(requestA, () => h.bus.run(command('during-request')));
    await enterPlatformScope(adminCtx, () => h.bus.run(command('worker')), {
      entryPoint: 'worker',
      container: createRootContainer(),
    });

    const worker = h.auditCalls.find((entry) => entry.objectId === 'worker');
    expect(fieldsOf(worker)).toEqual({ ipAddress: null, userAgent: null, requestId: null });
  });

  it('records no request fields for a worker scope opened inside a request', async () => {
    const h = makeHarness();

    await inRequest(requestA, () =>
      enterPlatformScope(adminCtx, () => h.bus.run(command('nested-worker')), {
        entryPoint: 'worker',
        container: createRootContainer(),
      }),
    );

    expect(fieldsOf(h.auditCalls[0])).toEqual({ ipAddress: null, userAgent: null, requestId: null });
  });

  it('records no request fields outside any platform scope (CLI, boot)', async () => {
    const h = makeHarness();

    await runWithTenantContext(adminCtx, () => h.bus.run(command('cli')));

    expect(fieldsOf(h.auditCalls[0])).toEqual({ ipAddress: null, userAgent: null, requestId: null });
  });

  it('lets an explicit getRequestMeta override the ambient scope', async () => {
    const auditCalls: RecordAuditInput[] = [];
    const fakeEm = {
      async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
        return cb(fakeEm as unknown as EntityManager);
      },
    };
    const bus = new CommandBus(
      { em: { fork: () => fakeEm } } as unknown as MikroORM,
      {
        recordWithin(_em: EntityManager, input: RecordAuditInput) {
          auditCalls.push(input);
          return {} as never;
        },
      } as unknown as AuditPort,
      new EventBus<Record<string, EventBase>>(),
      { getRequestMeta: () => ({ requestId: 'explicit' }) },
    );

    await inRequest(requestA, () => bus.run(command('explicit')));

    expect(fieldsOf(auditCalls[0])).toEqual({ ipAddress: null, userAgent: null, requestId: 'explicit' });
  });
});
