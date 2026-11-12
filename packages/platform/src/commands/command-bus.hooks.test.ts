import { describe, expect, expectTypeOf, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { hookableAction, type HookableActionRef } from '@endora-commerce/contracts';
import { CommandBus } from './command-bus.js';
import type { Command, CommandActor } from './command.js';
import { CommandHookRegistry, type CommandHookCompositionInput } from './hooks/registry.js';
import type { CommandHookContext, CommandHookEntry } from './hooks/types.js';
import { EventBus, type EventBase } from '../events/bus.js';
import { HttpError } from '../http/error-envelope.js';
import type { AuditPort, RecordAuditInput } from '../kernel/ports/audit.js';
import { runWithTenantContext, type TenantContext } from '../tenancy/tenant-context.js';

/**
 * `specs/176-command-hooks-outbox/` T025 (FR-015 – FR-020, FR-022, FR-023,
 * SC-002): `beforeCommit` hooks on a real `CommandBus`.
 *
 * The fake EM is transactional in the one way these assertions need: a
 * "row" (`em.persist`) and an audit entry are buffered per transaction and
 * reach `committed` only when the callback resolves, so "no rows and no
 * entries" after a veto is a measurement rather than an assumption.
 */

interface Row {
  readonly table: string;
  readonly id: string;
}

function makeHarness(options: { present?: (moduleId: string) => boolean } = {}) {
  const committedRows: Row[] = [];
  const committedAudit: RecordAuditInput[] = [];
  let pendingRows: Row[] = [];
  let pendingAudit: RecordAuditInput[] = [];
  const fakeEm = {
    persist(row: Row) {
      pendingRows.push(row);
    },
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      pendingRows = [];
      pendingAudit = [];
      const result = await cb(fakeEm as unknown as EntityManager);
      committedRows.push(...pendingRows);
      committedAudit.push(...pendingAudit);
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
  const bus = new CommandBus(fakeOrm, audit, events, { hooks: registry });
  return { bus, registry, committedRows, committedAudit, events };
}

const adminCtx: TenantContext = { mode: 'all', actor: { kind: 'admin', id: 'admin-1' } };
const run = <T>(fn: () => Promise<T>): Promise<T> => runWithTenantContext(adminCtx, fn);

interface WidgetHookData {
  readonly widget: { readonly id: string; readonly name: string };
}
const WIDGET_CREATE = hookableAction<WidgetHookData>('widget.create', 'widget', ['beforeCommit', 'afterCommit']);
const NOTE_CREATE = hookableAction<{ noteId: string }>('note.create', 'note', ['beforeCommit']);

function composition(extra: Partial<CommandHookCompositionInput> = {}): CommandHookCompositionInput {
  return {
    hookableActions: [
      { moduleId: 'widgets', action: 'widget.create', objectType: 'widget', phases: ['beforeCommit', 'afterCommit'] },
      { moduleId: 'notes', action: 'note.create', objectType: 'note', phases: ['beforeCommit'] },
    ],
    moduleDependencies: {
      widgets: [],
      notes: [],
      acme_erp: ['widgets'],
      acme_crm: ['acme_erp', 'widgets', 'notes'],
    },
    commandHookOrder: {},
    ...extra,
  };
}

function createWidget(overrides: Partial<Command<{ id: string; name: string }>> = {}): Command<{ id: string; name: string }> {
  return {
    action: 'widget.create',
    objectType: 'widget',
    objectId: 'w-1',
    async run({ em }) {
      (em as unknown as { persist(row: Row): void }).persist({ table: 'widgets', id: 'w-1' });
      return { result: { id: 'w-1', name: 'Gizmo' }, after: { changedFields: ['name'] } };
    },
    hookData: (result) => ({ widget: result }) satisfies WidgetHookData,
    ...overrides,
  };
}

function createNote(id: string): Command<{ noteId: string }> {
  return {
    action: 'note.create',
    objectType: 'note',
    objectId: id,
    async run({ em }) {
      (em as unknown as { persist(row: Row): void }).persist({ table: 'notes', id });
      return { result: { noteId: id }, after: { kind: 'plain' } };
    },
    hookData: (result) => result,
  };
}

describe('CommandBus — beforeCommit hooks (176 T025)', () => {
  it('runs a hook on the same em and actor, after run and before the audit entry', async () => {
    const h = makeHarness();
    const seen: Array<{ em: unknown; actor: CommandActor; data: WidgetHookData; objectId: string }> = [];
    let ownerEm: unknown;
    h.registry.register('acme_erp', [
      {
        id: 'observe',
        on: WIDGET_CREATE,
        phase: 'beforeCommit',
        handler: (ctx) => {
          seen.push({ em: ctx.em, actor: ctx.actor, data: ctx.data, objectId: ctx.objectId });
          expect(h.committedAudit).toHaveLength(0);
        },
      },
    ]);
    h.registry.seal(composition());

    await run(() =>
      h.bus.run(
        createWidget({
          async run({ em }) {
            ownerEm = em;
            return { result: { id: 'w-1', name: 'Gizmo' }, after: null };
          },
        }),
      ),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]!.em).toBe(ownerEm);
    expect(seen[0]!.actor).toMatchObject({ actorAdminUserId: 'admin-1', kind: 'admin' });
    expect(seen[0]!.data).toEqual({ widget: { id: 'w-1', name: 'Gizmo' } });
    expect(seen[0]!.objectId).toBe('w-1');
    expect(h.committedAudit.map((entry) => entry.action)).toEqual(['widget.create']);
  });

  it("audits a child run through ctx.run inside the owner's transaction, as its own entry", async () => {
    const h = makeHarness();
    h.registry.register('acme_crm', [
      {
        id: 'add-note',
        on: WIDGET_CREATE,
        phase: 'beforeCommit',
        handler: async (ctx) => {
          await ctx.run(createNote('n-1'));
        },
      },
    ]);
    h.registry.seal(composition());

    await run(() => h.bus.run(createWidget()));

    expect(h.committedRows).toEqual([
      { table: 'widgets', id: 'w-1' },
      { table: 'notes', id: 'n-1' },
    ]);
    expect(h.committedAudit.map((entry) => entry.action)).toEqual(['note.create', 'widget.create']);
  });

  it('propagates an HttpError veto unchanged, and nothing commits', async () => {
    const h = makeHarness();
    h.registry.register('acme_crm', [
      {
        id: 'add-note-then-refuse',
        on: WIDGET_CREATE,
        phase: 'beforeCommit',
        handler: async (ctx) => {
          await ctx.run(createNote('n-1'));
          throw new HttpError(409, 'ACME_WIDGET_REFUSED' as never, 'Refused.', [{ path: 'name', issue: 'taken' }]);
        },
      },
    ]);
    h.registry.seal(composition());

    const err = await run(() => h.bus.run(createWidget())).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ statusCode: 409, code: 'ACME_WIDGET_REFUSED', details: [{ path: 'name', issue: 'taken' }] });
    expect(h.committedRows).toEqual([]);
    expect(h.committedAudit).toEqual([]);
  });

  it('rolls back on a throw that is not an HttpError, which the envelope answers 500', async () => {
    const h = makeHarness();
    h.registry.register('acme_erp', [
      {
        id: 'broken',
        on: WIDGET_CREATE,
        phase: 'beforeCommit',
        handler: () => {
          throw new TypeError('hook bug');
        },
      },
    ]);
    h.registry.seal(composition());

    const err = await run(() => h.bus.run(createWidget())).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(HttpError);
    expect(h.committedRows).toEqual([]);
    expect(h.committedAudit).toEqual([]);
  });

  it('skips a hook whose module is absent, as if it were never installed (XVII)', async () => {
    const present = new Set(['widgets']);
    const h = makeHarness({ present: (moduleId) => present.has(moduleId) });
    let calls = 0;
    h.registry.register('acme_erp', [
      {
        id: 'veto',
        on: WIDGET_CREATE,
        phase: 'beforeCommit',
        handler: () => {
          calls += 1;
          throw new HttpError(409, 'ACME_WIDGET_REFUSED' as never, 'Refused.');
        },
      },
    ]);
    h.registry.seal(composition());

    await run(() => h.bus.run(createWidget()));
    expect(calls).toBe(0);
    expect(h.committedRows).toEqual([{ table: 'widgets', id: 'w-1' }]);
    expect(h.committedAudit).toHaveLength(1);
    expect(h.committedAudit[0]!.stateAfter).toEqual({ changedFields: ['name'] });

    // Per call, from the live state: switched back on, the next Command runs it.
    present.add('acme_erp');
    await expect(run(() => h.bus.run(createWidget()))).rejects.toMatchObject({ code: 'ACME_WIDGET_REFUSED' });
    expect(calls).toBe(1);
  });

  it('hands each hook only its own module’s extension slice', async () => {
    const h = makeHarness();
    const seen: Record<string, unknown> = {};
    h.registry.register('acme_erp', [
      { id: 'read', on: WIDGET_CREATE, phase: 'beforeCommit', handler: (ctx) => void (seen['acme_erp'] = ctx.extension) },
    ]);
    h.registry.register('acme_crm', [
      { id: 'read', on: WIDGET_CREATE, phase: 'beforeCommit', handler: (ctx) => void (seen['acme_crm'] = ctx.extension) },
    ]);
    h.registry.seal(composition());

    await run(() => h.bus.run(createWidget({ extensions: { acme_erp: { code: 'E-1' } } })));

    expect(seen).toEqual({ acme_erp: { code: 'E-1' }, acme_crm: undefined });
  });

  it('types a hook’s data by the ref it registers against', () => {
    type Entry = Extract<CommandHookEntry<typeof WIDGET_CREATE>, { phase: 'beforeCommit' }>;
    expectTypeOf<Parameters<Entry['handler']>[0]>().toEqualTypeOf<CommandHookContext<WidgetHookData>>();
    expectTypeOf<typeof WIDGET_CREATE>().toMatchTypeOf<HookableActionRef<WidgetHookData>>();
  });

  it('refuses an extension key no present hook module claims with 422, before any write', async () => {
    const present = new Set(['widgets', 'acme_crm']);
    const h = makeHarness({ present: (moduleId) => present.has(moduleId) });
    let ran = false;
    h.registry.register('acme_erp', [{ id: 'read', on: WIDGET_CREATE, phase: 'beforeCommit', handler: () => undefined }]);
    h.registry.seal(composition());

    for (const extensions of [{ acme_typo: { code: 'x' } }, { acme_erp: { code: 'off' } }]) {
      const err = await run(() =>
        h.bus.run(
          createWidget({
            extensions,
            async run() {
              ran = true;
              return { result: { id: 'w-1', name: 'Gizmo' } };
            },
          }),
        ),
      ).catch((e: unknown) => e);
      const key = Object.keys(extensions)[0]!;
      expect(err).toBeInstanceOf(HttpError);
      expect(err).toMatchObject({
        statusCode: 422,
        code: 'COMMAND_EXTENSION_UNCLAIMED',
        details: [{ path: `extensions.${key}` }],
      });
    }
    expect(ran).toBe(false);
    expect(h.committedAudit).toEqual([]);
  });

  it("merges noted changes into the owner's single entry, as names under extensions.<module>", async () => {
    const h = makeHarness();
    h.registry.register('acme_erp', [
      {
        id: 'write-own-columns',
        on: WIDGET_CREATE,
        phase: 'beforeCommit',
        handler: (ctx) => {
          ctx.noteAuditChanges(['x_acme_erp_code', 'x_acme_erp_branch']);
          ctx.noteAuditChanges(['x_acme_erp_code']);
        },
      },
    ]);
    h.registry.seal(composition());

    await run(() => h.bus.run(createWidget()));

    expect(h.committedAudit).toHaveLength(1);
    expect(h.committedAudit[0]!.stateAfter).toEqual({
      changedFields: ['name'],
      extensions: { acme_erp: { changedFields: ['x_acme_erp_branch', 'x_acme_erp_code'] } },
    });
  });

  it('turns a null after-state into { extensions } when a hook noted a change', async () => {
    const h = makeHarness();
    h.registry.register('acme_erp', [
      { id: 'note', on: WIDGET_CREATE, phase: 'beforeCommit', handler: (ctx) => ctx.noteAuditChanges(['x_acme_erp_code']) },
    ]);
    h.registry.seal(composition());

    await run(() =>
      h.bus.run(createWidget({ async run() { return { result: { id: 'w-1', name: 'Gizmo' }, after: null }; } })),
    );

    expect(h.committedAudit[0]!.stateAfter).toEqual({ extensions: { acme_erp: { changedFields: ['x_acme_erp_code'] } } });
  });

  it('records exactly one entry when the owner skips its audit but a hook noted a write', async () => {
    const h = makeHarness();
    h.registry.register('acme_erp', [
      { id: 'note', on: WIDGET_CREATE, phase: 'beforeCommit', handler: (ctx) => ctx.noteAuditChanges(['x_acme_erp_code']) },
    ]);
    h.registry.seal(composition());

    await run(() =>
      h.bus.run(
        createWidget({
          async run() {
            return { result: { id: 'w-1', name: 'Gizmo' }, before: { status: 'S176-OWNER' }, after: { status: 'x' }, skipAudit: true };
          },
        }),
      ),
    );

    expect(h.committedAudit).toHaveLength(1);
    expect(h.committedAudit[0]).toMatchObject({
      action: 'widget.create',
      stateBefore: null,
      stateAfter: { extensions: { acme_erp: { changedFields: ['x_acme_erp_code'] } } },
    });
  });

  it('records no entry when the owner skips its audit and no hook noted anything', async () => {
    const h = makeHarness();
    let calls = 0;
    h.registry.register('acme_erp', [{ id: 'read', on: WIDGET_CREATE, phase: 'beforeCommit', handler: () => void (calls += 1) }]);
    h.registry.seal(composition());

    await run(() =>
      h.bus.run(
        createWidget({
          async run() {
            return { result: { id: 'w-1', name: 'Gizmo' }, skipAudit: true };
          },
        }),
      ),
    );

    expect(calls).toBe(1);
    expect(h.committedAudit).toEqual([]);
  });

  it('refuses a noted change that is not a field name — the entry carries names, never values', async () => {
    const h = makeHarness();
    h.registry.register('acme_erp', [
      { id: 'note', on: WIDGET_CREATE, phase: 'beforeCommit', handler: (ctx) => ctx.noteAuditChanges(['ACME Sp. z o.o.']) },
    ]);
    h.registry.seal(composition());

    await expect(run(() => h.bus.run(createWidget()))).rejects.toThrow(/field name/);
    expect(h.committedAudit).toEqual([]);
  });

  it('refuses an action reappearing in its own hook chain with COMMAND_HOOK_CYCLE', async () => {
    const h = makeHarness();
    h.registry.register('acme_crm', [
      { id: 'recurse', on: WIDGET_CREATE, phase: 'beforeCommit', handler: async (ctx) => void (await ctx.run(createWidget())) },
    ]);
    h.registry.seal(composition());

    const err = await run(() => h.bus.run(createWidget())).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ statusCode: 500, code: 'COMMAND_HOOK_CYCLE' });
    expect(h.committedAudit).toEqual([]);
  });

  it('refuses the ninth Command of one hook chain with COMMAND_HOOK_CYCLE', async () => {
    const h = makeHarness();
    const refs = Array.from({ length: 9 }, (_, i) => hookableAction<unknown>(`step.s${i + 1}`, 'step', ['beforeCommit']));
    const step = (i: number): Command<number> => ({
      action: `step.s${i + 1}`,
      objectType: 'step',
      objectId: `s${i + 1}`,
      async run() {
        return { result: i };
      },
      hookData: (result) => result,
    });
    for (let i = 0; i < 8; i += 1) {
      h.registry.register('acme_crm', [
        { id: `next-${i + 1}`, on: refs[i]!, phase: 'beforeCommit', handler: async (ctx) => void (await ctx.run(step(i + 1))) },
      ]);
    }
    h.registry.seal(
      composition({
        hookableActions: refs.map((ref) => ({ moduleId: 'steps', action: ref.action, objectType: 'step', phases: ['beforeCommit'] })),
        moduleDependencies: { steps: [], acme_crm: ['steps'] },
      }),
    );

    const err = await run(() => h.bus.run(step(0))).catch((e: unknown) => e);

    expect(err).toMatchObject({ statusCode: 500, code: 'COMMAND_HOOK_CYCLE' });
    expect(h.committedAudit).toEqual([]);
  });

  it('allows a chain of eight', async () => {
    const h = makeHarness();
    const refs = Array.from({ length: 8 }, (_, i) => hookableAction<unknown>(`step.s${i + 1}`, 'step', ['beforeCommit']));
    const step = (i: number): Command<number> => ({
      action: `step.s${i + 1}`,
      objectType: 'step',
      objectId: `s${i + 1}`,
      async run() {
        return { result: i };
      },
      hookData: (result) => result,
    });
    for (let i = 0; i < 7; i += 1) {
      h.registry.register('acme_crm', [
        { id: `next-${i + 1}`, on: refs[i]!, phase: 'beforeCommit', handler: async (ctx) => void (await ctx.run(step(i + 1))) },
      ]);
    }
    h.registry.seal(
      composition({
        hookableActions: refs.map((ref) => ({ moduleId: 'steps', action: ref.action, objectType: 'step', phases: ['beforeCommit'] })),
        moduleDependencies: { steps: [], acme_crm: ['steps'] },
      }),
    );

    await run(() => h.bus.run(step(0)));
    expect(h.committedAudit).toHaveLength(8);
  });

  it('refuses a hooked Command that supplies no hookData with COMMAND_HOOK_DATA_MISSING', async () => {
    const h = makeHarness();
    let calls = 0;
    h.registry.register('acme_erp', [{ id: 'read', on: WIDGET_CREATE, phase: 'beforeCommit', handler: () => void (calls += 1) }]);
    h.registry.seal(composition());

    const { hookData: _omitted, ...withoutHookData } = createWidget();
    const err = await run(() => h.bus.run(withoutHookData as Command<{ id: string; name: string }>)).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ statusCode: 500, code: 'COMMAND_HOOK_DATA_MISSING' });
    expect(calls).toBe(0);
    expect(h.committedAudit).toEqual([]);
  });

  it('leaves an unhooked Command exactly as it was: no hookData asked, one entry', async () => {
    const h = makeHarness();
    h.registry.seal(composition());
    const { hookData: _omitted, ...plain } = createWidget();
    await run(() => h.bus.run(plain as Command<{ id: string; name: string }>));
    expect(h.committedAudit.map((entry) => entry.stateAfter)).toEqual([{ changedFields: ['name'] }]);
  });

  it('runs the hooks of one action in the derived order', async () => {
    const h = makeHarness();
    const order: string[] = [];
    h.registry.register('acme_crm', [{ id: 'second', on: WIDGET_CREATE, phase: 'beforeCommit', handler: () => void order.push('acme_crm') }]);
    h.registry.register('acme_erp', [{ id: 'first', on: WIDGET_CREATE, phase: 'beforeCommit', handler: () => void order.push('acme_erp') }]);
    h.registry.seal(composition());
    await run(() => h.bus.run(createWidget()));
    expect(order).toEqual(['acme_erp', 'acme_crm']);
  });

  it('runs a hooked child’s own hooks, inside the same transaction', async () => {
    const h = makeHarness();
    const seen: string[] = [];
    h.registry.register('acme_crm', [
      { id: 'add-note', on: WIDGET_CREATE, phase: 'beforeCommit', handler: async (ctx) => void (await ctx.run(createNote('n-1'))) },
      { id: 'see-note', on: NOTE_CREATE, phase: 'beforeCommit', handler: (ctx) => void seen.push(ctx.data.noteId) },
    ]);
    h.registry.seal(composition());
    await run(() => h.bus.run(createWidget()));
    expect(seen).toEqual(['n-1']);
  });
});
