import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  hookableAction,
  type CommandMiddlewareDeclaration,
  type ErrorCode,
  type ModuleOrigin,
} from '@endora-commerce/contracts';
import { ADMISSION_EXEMPT_ACTIONS, CommandBus } from './command-bus.js';
import type { Command } from './command.js';
import { CommandHookRegistry } from './hooks/registry.js';
import { CommandRefusedError } from './middleware/errors.js';
import { CommandMiddlewareRegistry } from './middleware/registry.js';
import type { CommandAdmissionMeta, CommandMiddlewareEntry, CommandRunOutcome } from './middleware/types.js';
import { EventBus, type EventBase } from '../events/bus.js';
import { HttpError } from '../http/error-envelope.js';
import type { PlatformLogger } from '../kernel/logging.js';
import type { AuditPort, RecordAuditInput } from '../kernel/ports/audit.js';
import { getTenantContext, runWithTenantContext, type TenantContext } from '../tenancy/tenant-context.js';

/**
 * `specs/189-command-middleware/` T012, T020, T030 (FR-010 – FR-015,
 * FR-020 – FR-022, FR-033): command middleware on a real `CommandBus`.
 *
 * The fake EM is transactional in the one way these assertions need: rows and
 * audit entries are buffered per transaction and reach `committed` only when
 * the callback resolves, so "no row and no entry" after a refusal is a
 * measurement. `transactional` and every `capture` push to `calls`, so the
 * order of admission relative to them is measured too.
 */

interface Row {
  readonly table: string;
  readonly id: string;
}

const REFUSED = 'ACME_HOLD_REFUSED' as ErrorCode;

interface LogLine {
  readonly level: 'info' | 'warn' | 'error';
  readonly obj: Record<string, unknown>;
  readonly msg: string;
}

function recordingLog(): PlatformLogger & { readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  return {
    lines,
    info: (obj, msg) => lines.push({ level: 'info', obj: obj as Record<string, unknown>, msg }),
    warn: (obj, msg) => lines.push({ level: 'warn', obj: obj as Record<string, unknown>, msg }),
    error: (obj, msg) => lines.push({ level: 'error', obj: obj as Record<string, unknown>, msg }),
  };
}

interface Contribution {
  readonly moduleId: string;
  readonly entries: readonly CommandMiddlewareEntry[];
  readonly actions?: CommandMiddlewareDeclaration['actions'];
  readonly timeoutMs?: number;
  readonly origin?: ModuleOrigin;
}

function makeHarness(
  contributions: readonly Contribution[],
  options: { present?: (moduleId: string) => boolean; hooks?: CommandHookRegistry; calls?: string[] } = {},
) {
  const calls: string[] = options.calls ?? [];
  const committedRows: Row[] = [];
  const committedAudit: RecordAuditInput[] = [];
  let pendingRows: Row[] = [];
  let pendingAudit: RecordAuditInput[] = [];
  const fakeEm = {
    persist(row: Row) {
      pendingRows.push(row);
    },
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      calls.push('transactional');
      pendingRows = [];
      pendingAudit = [];
      const result = await cb(fakeEm as unknown as EntityManager);
      committedRows.push(...pendingRows);
      committedAudit.push(...pendingAudit);
      return result;
    },
  };
  const orm = { em: { fork: () => fakeEm } } as unknown as MikroORM;
  const audit = {
    recordWithin(_em: EntityManager, entry: RecordAuditInput) {
      pendingAudit.push(entry);
      return {} as never;
    },
  } as unknown as AuditPort;
  const log = recordingLog();
  const middleware = new CommandMiddlewareRegistry({ log, ...(options.present ? { isPresent: options.present } : {}) });
  const declarations: Array<CommandMiddlewareDeclaration & { moduleId: string }> = [];
  const origins: Record<string, ModuleOrigin> = {};
  for (const contribution of contributions) {
    middleware.register(contribution.moduleId, contribution.entries);
    origins[contribution.moduleId] = contribution.origin ?? 'deployment';
    for (const entry of contribution.entries) {
      declarations.push({
        moduleId: contribution.moduleId,
        id: entry.id,
        phase: entry.phase,
        actions: contribution.actions ?? '*',
        ...(contribution.timeoutMs === undefined ? {} : { timeoutMs: contribution.timeoutMs }),
      });
    }
  }
  const moduleIds = [...new Set(contributions.map((c) => c.moduleId))].sort();
  middleware.seal({
    declarations,
    moduleDependencies: {},
    origins,
    ...(moduleIds.filter((id) => contributions.some((c) => c.moduleId === id && c.entries.some((e) => e.phase === 'admit'))).length > 1
      ? { commandMiddlewareOrder: moduleIds.filter((id) => contributions.some((c) => c.moduleId === id && c.entries.some((e) => e.phase === 'admit'))) }
      : {}),
  });
  const bus = new CommandBus(orm, audit, new EventBus<Record<string, EventBase>>(), {
    middleware,
    getRequestMeta: () => ({ requestId: 'req-1', ipAddress: '203.0.113.7', userAgent: 'agent/1' }),
    ...(options.hooks ? { hooks: options.hooks } : {}),
  });
  return { bus, middleware, calls, committedRows, committedAudit, log };
}

const adminCtx: TenantContext = { mode: 'all', actor: { kind: 'admin', id: 'admin-1' } };
const orgCtx: TenantContext = {
  mode: 'single-org',
  organizationId: 'org-1',
  actor: { kind: 'customer', id: 'cust-1' },
  customerAccountId: 'cust-1',
};
const asAdmin = <T>(fn: () => Promise<T>): Promise<T> => runWithTenantContext(adminCtx, fn);

function write(action: string, id: string, calls: string[], children: Command<unknown>[] = [], catchChild = false): Command<string> {
  return {
    action,
    objectType: action.split('.')[0]!,
    objectId: id,
    async capture() {
      calls.push(`capture:${action}`);
      return null;
    },
    async run(ctx) {
      (ctx.em as unknown as { persist(row: Row): void }).persist({ table: action, id });
      for (const child of children) {
        if (catchChild) {
          try {
            await ctx.run!(child);
          } catch {
            // the parent carries on
          }
        } else {
          await ctx.run!(child);
        }
      }
      return { result: id, after: { changedFields: ['name'] } };
    },
  };
}

const admitWhen =
  (refuse: (meta: CommandAdmissionMeta) => boolean, seen?: CommandAdmissionMeta[], calls?: string[]) =>
  (meta: CommandAdmissionMeta): void => {
    seen?.push(meta);
    calls?.push(`admit:${meta.action}`);
    if (refuse(meta)) throw new CommandRefusedError(REFUSED, { status: 403 });
  };

afterEach(() => {
  vi.useRealTimers();
});

describe('CommandBus — admit (189 T012)', () => {
  it('admits the root before the transaction opens, and a child before its capture', async () => {
    const calls: string[] = [];
    const h = makeHarness([{ moduleId: 'acme_hold', entries: [{ id: 'hold', phase: 'admit', admit: admitWhen(() => false, undefined, calls) }] }], { calls });
    const child = write('organization.admin_patch', 'org-1', calls);
    await asAdmin(() => h.bus.run(write('quote.convert', 'q-1', calls, [child])));
    expect(calls).toEqual([
      'admit:quote.convert',
      'transactional',
      'capture:quote.convert',
      'admit:organization.admin_patch',
      'capture:organization.admin_patch',
    ]);
  });

  it('admits a hook-started child, with viaHook in its lineage', async () => {
    const seen: CommandAdmissionMeta[] = [];
    const hooks = new CommandHookRegistry();
    const calls: string[] = [];
    hooks.register('acme_erp', [
      {
        id: 'sync',
        on: hookableAction('widget.create', 'widget', ['beforeCommit']),
        phase: 'beforeCommit',
        handler: async ({ run }) => {
          await run(write('note.create', 'n-1', calls));
        },
      },
    ]);
    hooks.seal({
      hookableActions: [{ moduleId: 'widgets', action: 'widget.create', objectType: 'widget', phases: ['beforeCommit'] }],
      moduleDependencies: { acme_erp: ['widgets'] },
    });
    const h = makeHarness([{ moduleId: 'acme_hold', entries: [{ id: 'hold', phase: 'admit', admit: admitWhen(() => false, seen) }] }], { hooks });
    const widget: Command<string> = { ...write('widget.create', 'w-1', calls), hookData: () => ({}) };
    await asAdmin(() => h.bus.run(widget));
    expect(seen.map((meta) => [meta.action, meta.lineage])).toEqual([
      ['widget.create', { ancestors: [], depth: 0, viaHook: false }],
      ['note.create', { ancestors: ['widget.create'], depth: 1, viaHook: true }],
    ]);
  });

  it('admits before the extensions check, so a refused Command never reaches it', async () => {
    const h = makeHarness([{ moduleId: 'acme_hold', entries: [{ id: 'hold', phase: 'admit', admit: admitWhen(() => true) }] }]);
    const withExtension: Command<string> = { ...write('widget.create', 'w-1', []), extensions: { nobody: { x: 1 } } };
    await expect(asAdmin(() => h.bus.run(withExtension))).rejects.toMatchObject({ code: REFUSED });
  });

  it('hands admit frozen metadata with the exact key set, and no data or em', async () => {
    const seen: CommandAdmissionMeta[] = [];
    const h = makeHarness([{ moduleId: 'acme_hold', entries: [{ id: 'hold', phase: 'admit', admit: admitWhen(() => false, seen) }] }]);
    await asAdmin(() => h.bus.run(write('widget.create', 'w-1', [])));
    const [meta] = seen;
    expect(Object.keys(meta!).sort()).toEqual(['action', 'actor', 'lineage', 'objectId', 'objectType', 'organizationId', 'requestMeta']);
    expect(Object.isFrozen(meta)).toBe(true);
    expect(Object.isFrozen(meta!.lineage)).toBe(true);
    expect(Object.isFrozen(meta!.requestMeta)).toBe(true);
    expect(meta).toMatchObject({
      action: 'widget.create',
      objectType: 'widget',
      objectId: 'w-1',
      organizationId: null,
      requestMeta: { requestId: 'req-1', ipAddress: '203.0.113.7', userAgent: 'agent/1' },
      lineage: { ancestors: [], depth: 0, viaHook: false },
    });
    expect(meta!.actor.kind).toBe('admin');
  });

  it('gives organizationId for a single-org context and null otherwise', async () => {
    const seen: CommandAdmissionMeta[] = [];
    const h = makeHarness([{ moduleId: 'acme_hold', entries: [{ id: 'hold', phase: 'admit', admit: admitWhen(() => false, seen) }] }]);
    await runWithTenantContext(orgCtx, () => h.bus.run(write('widget.create', 'w-1', [])));
    await asAdmin(() => h.bus.run(write('widget.create', 'w-2', [])));
    expect(seen.map((meta) => meta.organizationId)).toEqual(['org-1', null]);
  });

  it('refuses with the module’s code, leaving no row and no audit entry', async () => {
    const h = makeHarness([{ moduleId: 'acme_hold', entries: [{ id: 'hold', phase: 'admit', admit: admitWhen((m) => m.actor.kind === 'api_key' || m.action === 'widget.create') }] }]);
    const error = await asAdmin(() => h.bus.run(write('widget.create', 'w-1', []))).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CommandRefusedError);
    expect(error).toMatchObject({ statusCode: 403, code: REFUSED });
    expect(h.committedRows).toEqual([]);
    expect(h.committedAudit).toEqual([]);
  });

  it('refuses a child, rolling the parent back with no row and no entry for either', async () => {
    const h = makeHarness([
      { moduleId: 'acme_hold', actions: ['organization.'], entries: [{ id: 'hold', phase: 'admit', admit: admitWhen((m) => m.objectId === 'org-1') }] },
    ]);
    const parent = write('quote.convert', 'q-1', [], [write('organization.admin_patch', 'org-1', [])]);
    await expect(asAdmin(() => h.bus.run(parent))).rejects.toMatchObject({ code: REFUSED });
    expect(h.committedRows).toEqual([]);
    expect(h.committedAudit).toEqual([]);
  });

  it('stops admission at the first refusal', async () => {
    const asked: string[] = [];
    const h = makeHarness([
      { moduleId: 'acme_a', entries: [{ id: 'first', phase: 'admit', admit: () => { asked.push('a'); throw new CommandRefusedError(REFUSED); } }] },
      { moduleId: 'acme_b', entries: [{ id: 'second', phase: 'admit', admit: () => void asked.push('b') }] },
    ]);
    await expect(asAdmin(() => h.bus.run(write('widget.create', 'w-1', [])))).rejects.toMatchObject({ code: REFUSED });
    expect(asked).toEqual(['a']);
  });

  it('keeps the parent’s entry when the parent catches a refused child', async () => {
    const h = makeHarness([
      { moduleId: 'acme_hold', entries: [{ id: 'hold', phase: 'admit', admit: admitWhen((m) => m.action === 'organization.admin_patch') }] },
    ]);
    const parent = write('quote.convert', 'q-1', [], [write('organization.admin_patch', 'org-1', [])], true);
    await asAdmin(() => h.bus.run(parent));
    expect(h.committedAudit.map((entry) => entry.action)).toEqual(['quote.convert']);
    expect(h.committedRows).toEqual([{ table: 'quote.convert', id: 'q-1' }]);
  });

  it('refuses COMMAND_ADMISSION_TIMEOUT when admit overruns its budget, aborting its signal', async () => {
    let signal: AbortSignal | undefined;
    const h = makeHarness([
      {
        moduleId: 'acme_hold',
        timeoutMs: 20,
        entries: [{ id: 'slow', phase: 'admit', admit: (_meta, ctx) => { signal = ctx.signal; return new Promise<void>(() => undefined); } }],
      },
    ]);
    const error = await asAdmin(() => h.bus.run(write('widget.create', 'w-1', []))).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 503, code: ERROR_CODES.COMMAND_ADMISSION_TIMEOUT });
    expect(signal?.aborted).toBe(true);
    expect(h.committedAudit).toEqual([]);
    expect(h.log.lines).toContainEqual(
      expect.objectContaining({ msg: 'command.admit.timeout', obj: expect.objectContaining({ middleware: 'acme_hold#slow' }) }),
    );
  });

  it('refuses COMMAND_ADMISSION_FAILED for any other throw, logging the class and never the message', async () => {
    class LookupBroke extends Error {}
    const h = makeHarness([
      { moduleId: 'acme_hold', entries: [{ id: 'hold', phase: 'admit', admit: () => { throw new LookupBroke('secret customer@example.com'); } }] },
    ]);
    const error = await asAdmin(() => h.bus.run(write('widget.create', 'w-1', []))).catch((err: unknown) => err);
    expect(error).toMatchObject({ statusCode: 503, code: ERROR_CODES.COMMAND_ADMISSION_FAILED });
    const line = h.log.lines.find((entry) => entry.msg === 'command.admit.failed');
    expect(line?.obj).toMatchObject({ middleware: 'acme_hold#hold', errorClass: 'LookupBroke' });
    expect(JSON.stringify(h.log.lines)).not.toContain('secret');
    expect((error as Error).message).not.toContain('secret');
  });

  it('maps an HttpError that is not a refusal to COMMAND_ADMISSION_FAILED too', async () => {
    const h = makeHarness([
      { moduleId: 'acme_hold', entries: [{ id: 'hold', phase: 'admit', admit: () => { throw new HttpError(503, ERROR_CODES.MODULE_DISABLED, 'off'); } }] },
    ]);
    await expect(asAdmin(() => h.bus.run(write('widget.create', 'w-1', [])))).rejects.toMatchObject({
      code: ERROR_CODES.COMMAND_ADMISSION_FAILED,
    });
  });

  it('never admits the activation Command', async () => {
    expect(ADMISSION_EXEMPT_ACTIONS).toEqual(['module.activation.set']);
    const h = makeHarness([{ moduleId: 'acme_hold', entries: [{ id: 'hold', phase: 'admit', admit: admitWhen(() => true) }] }]);
    await expect(asAdmin(() => h.bus.run(write('module.activation.set', 'acme_hold', [])))).resolves.toBe('acme_hold');
    expect(h.committedAudit.map((entry) => entry.action)).toEqual(['module.activation.set']);
  });

  it('refuses a Command run from inside an admit with COMMAND_MIDDLEWARE_REENTRY', async () => {
    let inner: unknown;
    const holder: { bus?: CommandBus } = {};
    const h = makeHarness([
      {
        moduleId: 'acme_hold',
        actions: ['widget.'],
        entries: [
          {
            id: 'hold',
            phase: 'admit',
            admit: async () => {
              inner = await holder.bus!.run(write('note.create', 'n-1', [])).catch((err: unknown) => err);
            },
          },
        ],
      },
    ]);
    holder.bus = h.bus;
    await asAdmin(() => h.bus.run(write('widget.create', 'w-1', [])));
    expect(inner).toMatchObject({ statusCode: 500, code: ERROR_CODES.COMMAND_MIDDLEWARE_REENTRY });
    expect(h.committedAudit.map((entry) => entry.action)).toEqual(['widget.create']);
  });

  it('passes the request-meta and actor of an API key, so a rule can refuse that actor kind', async () => {
    const h = makeHarness([{ moduleId: 'acme_hold', entries: [{ id: 'hold', phase: 'admit', admit: admitWhen((m) => m.actor.kind === 'api_key') }] }]);
    const apiKeyCtx: TenantContext = { mode: 'single-org', organizationId: 'org-1', actor: { kind: 'api_key', id: 'key-1' } };
    await expect(runWithTenantContext(apiKeyCtx, () => h.bus.run(write('widget.create', 'w-1', [])))).rejects.toMatchObject({ code: REFUSED });
    expect(h.committedRows).toEqual([]);
  });
});


describe('CommandBus — observe (189 T020)', () => {
  function recorder(seen: CommandRunOutcome[]) {
    return (outcome: CommandRunOutcome): void => {
      seen.push(outcome);
    };
  }

  it('observes a committed run after the commit, one entry per Command, names only', async () => {
    const seen: CommandRunOutcome[] = [];
    const hooks = new CommandHookRegistry();
    hooks.register('acme_erp', [
      {
        id: 'mirror',
        on: hookableAction('organization.admin_patch', 'organization', ['beforeCommit']),
        phase: 'beforeCommit',
        handler: ({ noteAuditChanges }) => noteAuditChanges(['x_acme_erp_code', 'x_acme_erp_class']),
      },
    ]);
    hooks.seal({
      hookableActions: [{ moduleId: 'organizations', action: 'organization.admin_patch', objectType: 'organization', phases: ['beforeCommit'] }],
      moduleDependencies: { acme_erp: ['organizations'] },
    });
    const h = makeHarness([{ moduleId: 'acme_metrics', entries: [{ id: 'timing', phase: 'observe', observe: recorder(seen) }] }], { hooks });
    const child: Command<string> = { ...write('organization.admin_patch', 'org-1', []), hookData: () => ({}) };
    await asAdmin(() => h.bus.run(write('quote.convert', 'q-1', [], [child])));
    await h.middleware.settled();
    expect(seen).toHaveLength(1);
    const [outcome] = seen;
    expect(outcome).toMatchObject({ committed: true, refusal: null, errorCode: null });
    expect(outcome!.root).toMatchObject({ action: 'quote.convert', lineage: { depth: 0 } });
    expect(outcome!.durationMs).toBeGreaterThanOrEqual(0);
    expect(outcome!.commands).toEqual([
      { action: 'quote.convert', objectType: 'quote', objectId: 'q-1', depth: 0, viaHook: false, refused: false, audited: true, notedFields: {} },
      {
        action: 'organization.admin_patch',
        objectType: 'organization',
        objectId: 'org-1',
        depth: 1,
        viaHook: false,
        refused: false,
        audited: true,
        notedFields: { acme_erp: ['x_acme_erp_class', 'x_acme_erp_code'] },
      },
    ]);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome!.commands[1])).toBe(true);
  });

  it('observes a rollback by a hook veto, with the veto’s code', async () => {
    const seen: CommandRunOutcome[] = [];
    const hooks = new CommandHookRegistry();
    hooks.register('acme_erp', [
      {
        id: 'veto',
        on: hookableAction('widget.create', 'widget', ['beforeCommit']),
        phase: 'beforeCommit',
        handler: () => {
          throw new HttpError(409, REFUSED, 'no');
        },
      },
    ]);
    hooks.seal({
      hookableActions: [{ moduleId: 'widgets', action: 'widget.create', objectType: 'widget', phases: ['beforeCommit'] }],
      moduleDependencies: { acme_erp: ['widgets'] },
    });
    const h = makeHarness([{ moduleId: 'acme_metrics', entries: [{ id: 'timing', phase: 'observe', observe: recorder(seen) }] }], { hooks });
    await expect(asAdmin(() => h.bus.run({ ...write('widget.create', 'w-1', []), hookData: () => ({}) }))).rejects.toThrow();
    await h.middleware.settled();
    expect(seen[0]).toMatchObject({ committed: false, refusal: null, errorCode: REFUSED });
    expect(seen[0]!.commands[0]).toMatchObject({ audited: false, refused: false });
  });

  it('gives INTERNAL_ERROR for a failure that is not an HttpError', async () => {
    const seen: CommandRunOutcome[] = [];
    const h = makeHarness([{ moduleId: 'acme_metrics', entries: [{ id: 'timing', phase: 'observe', observe: recorder(seen) }] }]);
    const broken: Command<string> = { ...write('widget.create', 'w-1', []), run: async () => { throw new TypeError('boom'); } };
    await expect(asAdmin(() => h.bus.run(broken))).rejects.toThrow(TypeError);
    await h.middleware.settled();
    expect(seen[0]).toMatchObject({ committed: false, errorCode: 'INTERNAL_ERROR' });
  });

  it('observes a refused root with the refusal naming the middleware and its code', async () => {
    const seen: CommandRunOutcome[] = [];
    const h = makeHarness([
      { moduleId: 'acme_hold', entries: [{ id: 'hold', phase: 'admit', admit: admitWhen(() => true) }] },
      { moduleId: 'acme_metrics', entries: [{ id: 'timing', phase: 'observe', observe: recorder(seen) }] },
    ]);
    await expect(asAdmin(() => h.bus.run(write('widget.create', 'w-1', [])))).rejects.toThrow(CommandRefusedError);
    await h.middleware.settled();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      committed: false,
      refusal: { middleware: 'acme_hold#hold', code: REFUSED },
      errorCode: REFUSED,
      commands: [{ action: 'widget.create', refused: true, audited: false }],
    });
  });

  it('observes a refused child the parent caught: the run commits, the child is refused and not audited', async () => {
    const seen: CommandRunOutcome[] = [];
    const h = makeHarness([
      { moduleId: 'acme_hold', entries: [{ id: 'hold', phase: 'admit', admit: admitWhen((m) => m.action === 'organization.admin_patch') }] },
      { moduleId: 'acme_metrics', entries: [{ id: 'timing', phase: 'observe', observe: recorder(seen) }] },
    ]);
    await asAdmin(() => h.bus.run(write('quote.convert', 'q-1', [], [write('organization.admin_patch', 'org-1', [])], true)));
    await h.middleware.settled();
    expect(seen[0]).toMatchObject({ committed: true, refusal: null, errorCode: null });
    expect(seen[0]!.commands.map((entry) => [entry.action, entry.refused, entry.audited])).toEqual([
      ['quote.convert', false, true],
      ['organization.admin_patch', true, false],
    ]);
  });

  it('calls the observer only after the caller’s promise settled and its continuation ran', async () => {
    let callerContinued = false;
    let continuedWhenObserved: boolean | undefined;
    const h = makeHarness([
      { moduleId: 'acme_metrics', entries: [{ id: 'timing', phase: 'observe', observe: () => void (continuedWhenObserved = callerContinued) }] },
    ]);
    await asAdmin(async () => {
      await h.bus.run(write('widget.create', 'w-1', []));
      callerContinued = true;
    });
    await h.middleware.settled();
    expect(continuedWhenObserved).toBe(true);
  });

  it('swallows and logs a throw or a timeout, leaves the result unchanged, and observes later runs', async () => {
    let calls = 0;
    const h = makeHarness([
      {
        moduleId: 'acme_metrics',
        timeoutMs: 20,
        entries: [
          {
            id: 'flaky',
            phase: 'observe',
            observe: () => {
              calls += 1;
              if (calls === 1) throw new RangeError('secret value 42');
              if (calls === 2) return new Promise<void>(() => undefined);
              return undefined;
            },
          },
        ],
      },
    ]);
    for (const id of ['w-1', 'w-2', 'w-3']) {
      await expect(asAdmin(() => h.bus.run(write('widget.create', id, [])))).resolves.toBe(id);
    }
    await h.middleware.settled();
    expect(calls).toBe(3);
    expect(h.log.lines.map((line) => [line.msg, line.obj['middleware'], line.obj['errorClass']])).toEqual([
      ['command.observe.failed', 'acme_metrics#flaky', 'RangeError'],
      ['command.observe.timeout', 'acme_metrics#flaky', undefined],
    ]);
    expect(JSON.stringify(h.log.lines)).not.toContain('secret');
  });

  it('gives an observer of origin package the request id only', async () => {
    const pkg: CommandRunOutcome[] = [];
    const overlay: CommandRunOutcome[] = [];
    const h = makeHarness([
      { moduleId: 'acme_pkg', origin: 'package', entries: [{ id: 'timing', phase: 'observe', observe: recorder(pkg) }] },
      { moduleId: 'acme_overlay', origin: 'deployment', entries: [{ id: 'timing', phase: 'observe', observe: recorder(overlay) }] },
    ]);
    await asAdmin(() => h.bus.run(write('widget.create', 'w-1', [])));
    await h.middleware.settled();
    expect(pkg[0]!.root.requestMeta).toEqual({ requestId: 'req-1' });
    expect(Object.isFrozen(pkg[0]!.root.requestMeta)).toBe(true);
    expect(overlay[0]!.root.requestMeta).toEqual({ requestId: 'req-1', ipAddress: '203.0.113.7', userAgent: 'agent/1' });
  });

  it('refuses and logs a Command run from inside an observer', async () => {
    const holder: { bus?: CommandBus } = {};
    const h = makeHarness([
      {
        moduleId: 'acme_metrics',
        actions: ['widget.'],
        entries: [{ id: 'writer', phase: 'observe', observe: async () => { await holder.bus!.run(write('note.create', 'n-1', [])); } }],
      },
    ]);
    holder.bus = h.bus;
    await asAdmin(() => h.bus.run(write('widget.create', 'w-1', [])));
    await h.middleware.settled();
    expect(h.committedAudit.map((entry) => entry.action)).toEqual(['widget.create']);
    expect(h.log.lines).toContainEqual(
      expect.objectContaining({ msg: 'command.observe.failed', obj: expect.objectContaining({ middleware: 'acme_metrics#writer', errorClass: 'HttpError' }) }),
    );
  });

  it('runs an observer in the run’s ambient tenant context, never a wider one (FR-024)', async () => {
    const contexts: Array<TenantContext | undefined> = [];
    const h = makeHarness([
      { moduleId: 'acme_metrics', entries: [{ id: 'timing', phase: 'observe', observe: () => void contexts.push(getTenantContext()) }] },
    ]);
    await runWithTenantContext(orgCtx, () => h.bus.run(write('widget.create', 'w-1', [])));
    await h.middleware.settled();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({ mode: 'single-org', organizationId: 'org-1' });
  });

  it('runs an observer whose filter matches any Command in the run, and sees the whole run', async () => {
    const seen: CommandRunOutcome[] = [];
    const h = makeHarness([
      { moduleId: 'acme_metrics', actions: ['organization.'], entries: [{ id: 'timing', phase: 'observe', observe: recorder(seen) }] },
    ]);
    await asAdmin(() => h.bus.run(write('widget.create', 'w-1', [])));
    await asAdmin(() => h.bus.run(write('quote.convert', 'q-1', [], [write('organization.admin_patch', 'org-1', [])])));
    await h.middleware.settled();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.root.action).toBe('quote.convert');
    expect(seen[0]!.commands.map((entry) => entry.action)).toEqual(['quote.convert', 'organization.admin_patch']);
  });
});
