import { describe, expect, it, vi } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { ERROR_CODES, hookableAction } from '@endora-commerce/contracts';
import { CommandBus } from './command-bus.js';
import type { Command } from './command.js';
import { CommandHookRegistry, type CommandHookCompositionInput } from './hooks/registry.js';
import { CommandOutboxEntry } from './outbox/command-outbox-entry.entity.js';
import type { OutboxWakePort } from './outbox/wake.js';
import { EventBus, type EventBase } from '../events/bus.js';
import { HttpError } from '../http/error-envelope.js';
import type { AuditPort, RecordAuditInput } from '../kernel/ports/audit.js';
import { runWithTenantContext, type TenantContext } from '../tenancy/tenant-context.js';

/**
 * `specs/176-command-hooks-outbox/` T040 (FR-030, FR-031, FR-033): the
 * `afterCommit` half of the Command Bus — one `command_outbox` row per present
 * handler, written on the Command's own transaction, and the wake-up enqueued
 * only once that transaction has committed.
 *
 * The fake EM buffers what is persisted per transaction and moves it to
 * `committed` only when the callback resolves, so "no row on rollback" is a
 * measurement. A row's `em` is recorded too: written on the transaction, or not
 * at all.
 */

interface Persisted {
  readonly row: unknown;
  readonly em: unknown;
}

function makeHarness(options: { present?: (moduleId: string) => boolean; wake?: OutboxWakePort } = {}) {
  const committed: unknown[] = [];
  const committedAudit: RecordAuditInput[] = [];
  let pending: Persisted[] = [];
  let pendingAudit: RecordAuditInput[] = [];
  const order: string[] = [];
  const fakeEm = {
    persist(row: unknown) {
      pending.push({ row, em: fakeEm });
    },
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      pending = [];
      pendingAudit = [];
      const result = await cb(fakeEm as unknown as EntityManager);
      committed.push(...pending.map((p) => p.row));
      committedAudit.push(...pendingAudit);
      order.push('commit');
      return result;
    },
  };
  const fakeOrm = { em: { fork: () => fakeEm } } as unknown as MikroORM;
  const audit = {
    recordWithin(_em: EntityManager, entry: RecordAuditInput) {
      pendingAudit.push(entry);
      return {} as never;
    },
  } as unknown as AuditPort;
  const registry = new CommandHookRegistry(options.present ? { isPresent: options.present } : {});
  const events = new EventBus<Record<string, EventBase>>();
  const wake: OutboxWakePort =
    options.wake ??
    ({
      wake: vi.fn(async () => {
        order.push('wake');
      }),
    } satisfies OutboxWakePort);
  const bus = new CommandBus(fakeOrm, audit, events, {
    hooks: registry,
    outboxWake: wake,
    getRequestMeta: () => ({ requestId: 'req-1' }),
  });
  const outboxRows = (): CommandOutboxEntry[] =>
    committed.filter((row): row is CommandOutboxEntry => row instanceof CommandOutboxEntry);
  const pendingOutboxEms = (): unknown[] =>
    pending.filter((p) => p.row instanceof CommandOutboxEntry).map((p) => p.em);
  return { bus, registry, committed, committedAudit, outboxRows, pendingOutboxEms, wake, order, fakeEm };
}

const ORG_ID = '7a4f3e2d-1c0b-4a9e-8d7c-6b5a4f3e2d1c';
const adminCtx: TenantContext = { mode: 'all', actor: { kind: 'admin', id: 'admin-1' } };
const run = <T>(fn: () => Promise<T>): Promise<T> => runWithTenantContext(adminCtx, fn);

interface WidgetOutbox {
  readonly [key: string]: string | null;
  readonly organizationId: string;
  readonly status: string;
}
const WIDGET_CREATE = hookableAction<{ id: string }, WidgetOutbox>('widget.create', 'widget', [
  'beforeCommit',
  'afterCommit',
]);
const PART_CREATE = hookableAction<{ id: string }, WidgetOutbox>('part.create', 'part', ['afterCommit']);

function composition(): CommandHookCompositionInput {
  return {
    hookableActions: [
      { moduleId: 'widgets', action: 'widget.create', objectType: 'widget', phases: ['beforeCommit', 'afterCommit'] },
      { moduleId: 'widgets', action: 'part.create', objectType: 'part', phases: ['afterCommit'] },
    ],
    moduleDependencies: { widgets: [], acme_erp: ['widgets'], acme_crm: ['widgets'] },
    commandHookOrder: {},
  };
}

function createWidget(overrides: Partial<Command<{ id: string }>> = {}): Command<{ id: string }> {
  return {
    action: 'widget.create',
    objectType: 'widget',
    objectId: 'w-1',
    async run() {
      return { result: { id: 'w-1' }, after: { status: 'active' } };
    },
    hookData: (result) => result,
    outboxData: () => ({ organizationId: ORG_ID, status: 'active' }),
    ...overrides,
  };
}

const notify = async (): Promise<void> => undefined;

describe('CommandBus — afterCommit outbox rows (176 T040)', () => {
  it('writes one row per present handler, on the transaction em, carrying the recorded causation', async () => {
    const h = makeHarness();
    h.registry.register('acme_erp', [{ id: 'notify-erp', on: WIDGET_CREATE, phase: 'afterCommit', handler: notify }]);
    h.registry.register('acme_crm', [{ id: 'notify-crm', on: WIDGET_CREATE, phase: 'afterCommit', handler: notify }]);
    h.registry.seal(composition());

    let emsAtRun: unknown[] = [];
    await run(() =>
      h.bus.run(
        createWidget({
          // Read once the bus has persisted the rows: still inside the transaction.
          event: () => {
            emsAtRun = h.pendingOutboxEms();
            return undefined;
          },
        }),
      ),
    );

    const rows = h.outboxRows();
    expect(rows.map((row) => `${row.hookModule}#${row.hookId}`).sort()).toEqual([
      'acme_crm#notify-crm',
      'acme_erp#notify-erp',
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        action: 'widget.create',
        objectType: 'widget',
        objectId: 'w-1',
        organizationId: ORG_ID,
        data: { organizationId: ORG_ID, status: 'active' },
        actorKind: 'admin',
        actorAdminUserId: 'admin-1',
        impersonatedCustomerAccountId: null,
        actorCustomerAccountId: null,
        requestId: 'req-1',
        status: 'pending',
        attempts: 0,
      });
    }
    // The audit entry and the rows commit together.
    expect(h.committedAudit).toHaveLength(1);
    // Rows are persisted after the event is buffered (R-8), so `event` saw none yet …
    expect(emsAtRun).toEqual([]);
  });

  it('persists the rows on the em the Command ran on', async () => {
    const h = makeHarness();
    h.registry.register('acme_erp', [{ id: 'notify-erp', on: WIDGET_CREATE, phase: 'afterCommit', handler: notify }]);
    h.registry.seal(composition());
    const persistSpy = vi.spyOn(h.fakeEm, 'persist');
    let runEm: unknown;
    await run(() =>
      h.bus.run(
        createWidget({
          async run({ em }) {
            runEm = em;
            return { result: { id: 'w-1' }, after: null };
          },
        }),
      ),
    );
    const outboxPersists = persistSpy.mock.calls.filter(([row]) => row instanceof CommandOutboxEntry);
    expect(outboxPersists).toHaveLength(1);
    expect(runEm).toBe(h.fakeEm);
  });

  it('writes no row when the Command rolls back', async () => {
    const h = makeHarness();
    h.registry.register('acme_erp', [
      { id: 'notify-erp', on: WIDGET_CREATE, phase: 'afterCommit', handler: notify },
      {
        id: 'veto',
        on: WIDGET_CREATE,
        phase: 'beforeCommit',
        handler: () => {
          throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'no');
        },
      },
    ]);
    h.registry.seal(composition());
    await expect(run(() => h.bus.run(createWidget()))).rejects.toMatchObject({ statusCode: 409 });
    expect(h.outboxRows()).toEqual([]);
    expect(h.wake.wake).not.toHaveBeenCalled();
  });

  it('writes no row for a handler whose module is not present', async () => {
    const h = makeHarness({ present: (moduleId) => moduleId !== 'acme_crm' });
    h.registry.register('acme_erp', [{ id: 'notify-erp', on: WIDGET_CREATE, phase: 'afterCommit', handler: notify }]);
    h.registry.register('acme_crm', [{ id: 'notify-crm', on: WIDGET_CREATE, phase: 'afterCommit', handler: notify }]);
    h.registry.seal(composition());
    await run(() => h.bus.run(createWidget()));
    expect(h.outboxRows().map((row) => row.hookModule)).toEqual(['acme_erp']);
  });

  it('writes no row, asks for no outbox data and wakes nothing when no handler is present', async () => {
    const h = makeHarness({ present: () => false });
    h.registry.register('acme_erp', [{ id: 'notify-erp', on: WIDGET_CREATE, phase: 'afterCommit', handler: notify }]);
    h.registry.seal(composition());
    const outboxData = vi.fn(() => ({ organizationId: ORG_ID, status: 'active' }));
    await run(() => h.bus.run(createWidget({ outboxData })));
    expect(outboxData).not.toHaveBeenCalled();
    expect(h.outboxRows()).toEqual([]);
    expect(h.wake.wake).not.toHaveBeenCalled();
  });

  it('refuses a hooked Command without outboxData: 500 COMMAND_HOOK_DATA_MISSING, nothing committed', async () => {
    const h = makeHarness();
    h.registry.register('acme_erp', [{ id: 'notify-erp', on: WIDGET_CREATE, phase: 'afterCommit', handler: notify }]);
    h.registry.seal(composition());
    const { outboxData: _omitted, ...withoutOutbox } = createWidget();
    await expect(run(() => h.bus.run(withoutOutbox as Command<{ id: string }>))).rejects.toMatchObject({
      statusCode: 500,
      code: ERROR_CODES.COMMAND_HOOK_DATA_MISSING,
    });
    expect(h.committed).toEqual([]);
    expect(h.committedAudit).toEqual([]);
  });

  it.each([
    ['a nested object', { organizationId: ORG_ID, status: 'active', owner: { name: 'Jan Kowalski' } }],
    ['a string longer than a code', { organizationId: ORG_ID, status: 'x'.repeat(200) }],
    ['free text', { organizationId: ORG_ID, status: 'Jan Kowalski' }],
  ])('refuses outbox data carrying %s, naming the key and never the value', async (_label, data) => {
    const h = makeHarness();
    h.registry.register('acme_erp', [{ id: 'notify-erp', on: WIDGET_CREATE, phase: 'afterCommit', handler: notify }]);
    h.registry.seal(composition());
    const error = (await run(() => h.bus.run(createWidget({ outboxData: () => data as never }))).catch(
      (caught: unknown) => caught,
    )) as Error;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('widget.create');
    expect(error.message).toMatch(/owner|status/);
    expect(error.message).not.toContain('Jan Kowalski');
    expect(error.message).not.toContain('x'.repeat(200));
    expect(h.committed).toEqual([]);
    expect(h.committedAudit).toEqual([]);
  });

  it('writes the rows of a child Command too, and wakes the drain once, after the commit', async () => {
    const h = makeHarness();
    h.registry.register('acme_erp', [
      { id: 'notify-widget', on: WIDGET_CREATE, phase: 'afterCommit', handler: notify },
      { id: 'notify-part', on: PART_CREATE, phase: 'afterCommit', handler: notify },
    ]);
    h.registry.seal(composition());
    const part: Command<{ id: string }> = {
      action: 'part.create',
      objectType: 'part',
      objectId: 'p-1',
      async run() {
        return { result: { id: 'p-1' }, after: null };
      },
      outboxData: () => ({ organizationId: ORG_ID, status: 'new' }),
    };
    await run(() =>
      h.bus.run(
        createWidget({
          async run(ctx) {
            await ctx.run!(part);
            return { result: { id: 'w-1' }, after: null };
          },
        }),
      ),
    );
    expect(h.outboxRows().map((row) => row.action).sort()).toEqual(['part.create', 'widget.create']);
    expect(h.wake.wake).toHaveBeenCalledTimes(1);
    expect(h.order).toEqual(['commit', 'wake']);
  });

  it('does not wake the drain after a commit that wrote no row', async () => {
    const h = makeHarness();
    h.registry.seal(composition());
    await run(() => h.bus.run(createWidget()));
    expect(h.wake.wake).not.toHaveBeenCalled();
  });

  it('swallows a failed wake-up: the row is in Postgres and the next scheduled tick delivers it', async () => {
    const wake: OutboxWakePort = { wake: vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))) };
    const h = makeHarness({ wake });
    h.registry.register('acme_erp', [{ id: 'notify-erp', on: WIDGET_CREATE, phase: 'afterCommit', handler: notify }]);
    h.registry.seal(composition());
    await expect(run(() => h.bus.run(createWidget()))).resolves.toEqual({ id: 'w-1' });
    expect(wake.wake).toHaveBeenCalledTimes(1);
    expect(h.outboxRows()).toHaveLength(1);
  });

  it('does not wait on the wake-up: a Redis that never answers cannot hold the request', async () => {
    const wake: OutboxWakePort = { wake: vi.fn(() => new Promise<void>(() => undefined)) };
    const h = makeHarness({ wake });
    h.registry.register('acme_erp', [{ id: 'notify-erp', on: WIDGET_CREATE, phase: 'afterCommit', handler: notify }]);
    h.registry.seal(composition());
    await expect(run(() => h.bus.run(createWidget()))).resolves.toEqual({ id: 'w-1' });
  });
});
