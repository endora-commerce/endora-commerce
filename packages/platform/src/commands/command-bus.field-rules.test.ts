import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { hookableAction } from '@endora-commerce/contracts';
import { CommandBus } from './command-bus.js';
import type { Command } from './command.js';
import { CommandHookRegistry, type CommandHookCompositionInput } from './hooks/registry.js';
import type { FieldRuleCheck, FieldRuleCheckContext } from './hooks/types.js';
import { EventBus, type EventBase } from '../events/bus.js';
import { HttpError } from '../http/error-envelope.js';
import type { AuditPort, RecordAuditInput } from '../kernel/ports/audit.js';
import { runWithTenantContext, type TenantContext } from '../tenancy/tenant-context.js';

/**
 * `specs/193-admin-form-extensions/` T021 (FR-041, `contracts/field-rules.md`
 * §5): the platform's field-rule check runs first in the `beforeCommit` phase
 * of a writer's action — before every module hook, outside 176's ordering, and
 * also on an action no module may hook (a rule-check-only writer). A refusal
 * rolls the Command back: no audit entry, no outbox row.
 */

interface Row {
  readonly table: string;
  readonly id: string;
}

function makeHarness() {
  const committedRows: Row[] = [];
  const committedAudit: RecordAuditInput[] = [];
  let pendingRows: Row[] = [];
  let pendingAudit: RecordAuditInput[] = [];
  const fakeEm = {
    persist(row: Row) {
      pendingRows.push(row);
      return fakeEm;
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
  const registry = new CommandHookRegistry();
  const bus = new CommandBus(fakeOrm, audit, new EventBus<Record<string, EventBase>>(), { hooks: registry });
  return { bus, registry, committedRows, committedAudit };
}

const adminCtx: TenantContext = { mode: 'all', actor: { kind: 'admin', id: 'admin-1' } };
const run = <T>(fn: () => Promise<T>): Promise<T> => runWithTenantContext(adminCtx, fn);

interface WidgetHookData {
  readonly widget: { readonly id: string; readonly name: string };
}
const WIDGET_UPDATE = hookableAction<WidgetHookData, { widgetId: string }>('widget.update', 'widget', ['beforeCommit', 'afterCommit']);

function composition(extra: Partial<CommandHookCompositionInput> = {}): CommandHookCompositionInput {
  return {
    hookableActions: [
      { moduleId: 'widgets', action: 'widget.update', objectType: 'widget', phases: ['beforeCommit', 'afterCommit'] },
    ],
    moduleDependencies: { widgets: [], acme_erp: ['widgets'], acme_crm: ['widgets'] },
    commandHookOrder: {},
    ...extra,
  };
}

type WidgetCommand = Command<{ id: string; name: string }>;

/** A widget Command; an override given as `undefined` removes that member. */
function updateWidget(action = 'widget.update', overrides: { readonly [K in keyof WidgetCommand]?: WidgetCommand[K] | undefined } = {}): WidgetCommand {
  const command: Record<string, unknown> = {
    action,
    objectType: 'widget',
    objectId: 'w-1',
    async run({ em }: { em: EntityManager }) {
      (em as unknown as { persist(row: Row): void }).persist({ table: 'widgets', id: 'w-1' });
      return { result: { id: 'w-1', name: 'Gizmo' }, after: { changedFields: ['name'] } };
    },
    hookData: (result: { id: string; name: string }) => ({ widget: result }) satisfies WidgetHookData,
    outboxData: (result: { id: string }) => ({ widgetId: result.id }),
    ...overrides,
  };
  for (const key of Object.keys(command)) if (command[key] === undefined) delete command[key];
  return command as unknown as WidgetCommand;
}

/** A field-rule check source answering `check` for `actions` and nothing else. */
function checkFor(actions: readonly string[], check: FieldRuleCheck) {
  return { fieldRuleCheck: (action: string) => (actions.includes(action) ? check : undefined) };
}

describe('CommandBus — the field-rule check (193 T021)', () => {
  it('runs before every module hook, whatever the deployment ordered', async () => {
    const h = makeHarness();
    const order: string[] = [];
    for (const moduleId of ['acme_erp', 'acme_crm']) {
      h.registry.register(moduleId, [
        { id: 'observe', on: WIDGET_UPDATE, phase: 'beforeCommit', handler: () => void order.push(moduleId) },
      ]);
    }
    // The two hook modules are unranked by the graph, so the deployment orders
    // them; the check is not a party to that order and needs no entry in it.
    h.registry.seal(composition({ commandHookOrder: { 'widget.update': ['acme_crm', 'acme_erp'] } }));
    const seen: FieldRuleCheckContext[] = [];
    h.registry.useFieldRuleCheck(
      checkFor(['widget.update'], (ctx) => {
        order.push('field-rules');
        seen.push(ctx);
      }),
    );

    await run(() => h.bus.run(updateWidget()));

    expect(order).toEqual(['field-rules', 'acme_crm', 'acme_erp']);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      action: 'widget.update',
      objectType: 'widget',
      objectId: 'w-1',
      data: { widget: { id: 'w-1', name: 'Gizmo' } },
      actor: { kind: 'admin', actorAdminUserId: 'admin-1' },
    });
    expect(h.committedAudit).toHaveLength(1);
  });

  it('raises no UnorderedCommandHooksError: it is never a registration', () => {
    const h = makeHarness();
    h.registry.register('acme_erp', [{ id: 'observe', on: WIDGET_UPDATE, phase: 'beforeCommit', handler: () => undefined }]);
    // One module hook and the check on one action, no `commandHookOrder`:
    // were the check a registration of another module, this would refuse.
    expect(() => h.registry.seal(composition())).not.toThrow();
    expect(() => h.registry.useFieldRuleCheck(checkFor(['widget.update'], () => undefined))).not.toThrow();
    expect(h.registry.plan().items.map((item) => `${item.module}#${item.id}`)).toEqual(['acme_erp#observe']);
  });

  it('runs with no module hook on the action, and on an action no module may hook', async () => {
    const h = makeHarness();
    h.registry.seal(composition());
    const actions: string[] = [];
    h.registry.useFieldRuleCheck(checkFor(['widget.update', 'widget.bulk_update.item'], (ctx) => void actions.push(ctx.action)));

    await run(() => h.bus.run(updateWidget()));
    await run(() => h.bus.run(updateWidget('widget.bulk_update.item', { outboxData: undefined })));

    expect(actions).toEqual(['widget.update', 'widget.bulk_update.item']);
    expect(h.committedAudit.map((entry) => entry.action)).toEqual(['widget.update', 'widget.bulk_update.item']);
  });

  it('refuses a writer that supplies no hook data', async () => {
    const h = makeHarness();
    h.registry.seal(composition());
    h.registry.useFieldRuleCheck(checkFor(['widget.bulk_update.item'], () => undefined));

    await expect(run(() => h.bus.run(updateWidget('widget.bulk_update.item', { hookData: undefined })))).rejects.toMatchObject({
      code: 'COMMAND_HOOK_DATA_MISSING',
    });
    expect(h.committedAudit).toHaveLength(0);
  });

  it('a refusal rolls back: no audit entry, no outbox row, and no module hook ran', async () => {
    const h = makeHarness();
    const ran: string[] = [];
    h.registry.register('acme_erp', [
      { id: 'observe', on: WIDGET_UPDATE, phase: 'beforeCommit', handler: () => void ran.push('hook') },
      { id: 'deliver', on: WIDGET_UPDATE, phase: 'afterCommit', handler: async () => undefined },
    ]);
    h.registry.seal(composition());
    h.registry.useFieldRuleCheck(
      checkFor(['widget.update'], () => {
        throw new HttpError(422, 'FIELD_RULE_VIOLATION', 'Some values break the rules of this form.', [
          { path: 'name', issue: 'too_long' },
        ]);
      }),
    );

    await expect(run(() => h.bus.run(updateWidget()))).rejects.toMatchObject({ statusCode: 422, code: 'FIELD_RULE_VIOLATION' });
    expect(ran).toEqual([]);
    expect(h.committedAudit).toHaveLength(0);
    expect(h.committedRows).toHaveLength(0);
  });

  it('leaves an action without a check exactly as it was: hook data is not even asked for', async () => {
    const h = makeHarness();
    h.registry.seal(composition());
    h.registry.useFieldRuleCheck(checkFor(['other.action'], () => {
      throw new Error('must not run');
    }));
    let asked = 0;

    await run(() =>
      h.bus.run(
        updateWidget('widget.update', {
          hookData: (result) => {
            asked += 1;
            return { widget: result };
          },
        }),
      ),
    );

    expect(asked).toBe(0);
    expect(h.committedAudit).toHaveLength(1);
    expect(h.committedRows).toEqual([{ table: 'widgets', id: 'w-1' }]);
  });

  it('accepts one field-rule check source per composition', () => {
    const h = makeHarness();
    h.registry.seal(composition());
    h.registry.useFieldRuleCheck(checkFor([], () => undefined));
    expect(() => h.registry.useFieldRuleCheck(checkFor([], () => undefined))).toThrow(/already/);
  });
});
