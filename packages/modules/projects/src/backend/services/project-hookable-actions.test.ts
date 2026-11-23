/**
 * `projects`' eight hookable actions (issue #1845; the mechanism is
 * `specs/176-command-hooks-outbox/`, `contracts/command-hooks-api.md` §4, §6).
 *
 * Every write is driven through the module's own services — `ProjectService`
 * and `MoveService`, the code the admin routes run — on a real `CommandBus`
 * with a sealed hook registry, so what is checked is what a hook author is
 * handed: the owner's declared data, after `run` and before the commit, ids,
 * codes and field names only (`specs/conventions/audit-state.md` list 1). The
 * EntityManager is a small in-memory world whose `transactional` keeps what a
 * Command wrote only when it resolves, so a veto is seen to leave it as it was.
 *
 * Four properties, per the spec's §4:
 *  1. a present hook runs on each declared action, with that action's data;
 *  2. a hook whose module is switched off is skipped, and the write behaves as
 *     if it were not installed;
 *  3. a `beforeCommit` veto refuses the write with the hook's own error and
 *     rolls it back — for a set written whole, the whole set;
 *  4. an `afterCommit` handler gets one outbox row per write, written on the
 *     Command's transaction, carrying the outbox data.
 */
import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import {
  PROJECT_HOOKABLE_ACTIONS as PROJECTS,
  type CreateProjectBody,
  type HookableActionRef,
  type OutboxData,
} from '@endora-commerce/contracts';
import {
  CommandBus,
  type Command,
  type CommandContext,
  type CommandHookContext,
  type CommandHookEntry,
} from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { expectHookableCommand, recordingCommandHooks, sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { manifest } from '../../manifest.js';
import { StageGraph } from '../domain/stage-graph.js';
import { Project } from '../entities/project.entity.js';
import { ProjectOrganization } from '../entities/project-organization.entity.js';
import { ProjectStage } from '../entities/project-stage.entity.js';
import { ProjectStageMove } from '../entities/project-stage-move.entity.js';
import { MoveService, type MoveServiceDeps } from './move-service.js';
import { PROJECTS_AUDIT_KEYS } from './project-audit-state.js';
import { ProjectService, type ProjectServiceDeps } from './project-service.js';

const PROJECT_ID = '00000000-0000-4000-8000-000001845001';
const STAGE_A = '00000000-0000-4000-8000-000001845002';
const STAGE_B = '00000000-0000-4000-8000-000001845003';
const ORG_1 = '00000000-0000-4000-8000-000001845004';
const ORG_2 = '00000000-0000-4000-8000-000001845005';
const ADMIN_ID = '00000000-0000-4000-8000-000001845006';
const LOSS_REASON_ID = '00000000-0000-4000-8000-000001845007';
const TEMPLATE_FREE: string | null = null;

/** Every value the trail keeps out — a title, a text, a value, a custom-field value, a Stage name. */
const SENTINEL = 'S1845-';
const HOOK_MODULE = 'acme_erp';

type HookRegistration = { moduleId: string; entries: readonly CommandHookEntry[] };

interface World {
  project: Project;
  stages: ProjectStage[];
  moves: ProjectStageMove[];
  organizationIds: string[];
}

function stage(id: string, position: number, completionPermitted: boolean): ProjectStage {
  return Object.assign(new ProjectStage(), {
    id,
    projectId: PROJECT_ID,
    name: `${SENTINEL}STAGE-${position}`,
    color: '#3b82f6',
    position,
    plannedDurationDays: 0,
    completionPermitted,
  });
}

function world(state: Project['state'] = 'open'): World {
  const project = Object.assign(new Project(), {
    id: PROJECT_ID,
    number: 'PRJ-001845',
    title: `${SENTINEL}TITLE`,
    description: `${SENTINEL}DESCRIPTION`,
    valueAmount: '100.00',
    valueCurrency: 'PLN',
    startOn: '2026-11-01',
    state,
    currentStageId: STAGE_A,
    lostStageId: state === 'lost' ? STAGE_A : null,
    visibility: 'inherit',
    customFieldValues: { investor: `${SENTINEL}CF` },
    version: 3,
    configurationVersion: 2,
    createdByAdminUserId: ADMIN_ID,
  });
  return {
    project,
    stages: [stage(STAGE_A, 1, false), stage(STAGE_B, 2, true)],
    moves: [Object.assign(new ProjectStageMove(), { projectId: PROJECT_ID, fromStageId: STAGE_A, toStageId: STAGE_B })],
    organizationIds: [ORG_1],
  };
}

/**
 * The services on a real bus over an in-memory world. `transactional`
 * snapshots the world and the pending audit entries and outbox rows, and
 * restores the world when the Command throws — which is what a rollback is.
 */
function harness(hooks: readonly HookRegistration[], options: { state?: Project['state']; isPresent?: (moduleId: string) => boolean } = {}) {
  const w = world(options.state);
  const audits: Array<Record<string, unknown>> = [];
  const outbox: Array<Record<string, unknown>> = [];
  let pendingAudits: Array<Record<string, unknown>> = [];
  let pendingOutbox: Array<Record<string, unknown>> = [];

  const em: Record<string, unknown> = {
    findOne: async (entity: unknown, where: { id?: string }) => {
      if (entity === Project) return where.id === PROJECT_ID ? w.project : null;
      if (entity === ProjectStage) return w.stages.find((s) => s.id === where.id) ?? null;
      return null;
    },
    find: async (entity: unknown) => {
      if (entity === ProjectStage) return w.stages;
      if (entity === ProjectStageMove) return w.moves;
      return [];
    },
    execute: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('nextval')) return [{ value: 1845 }];
      if (sql.includes('insert into "project_organizations"')) {
        const organizationId = params[1] as string;
        if (w.organizationIds.includes(organizationId)) return [];
        w.organizationIds.push(organizationId);
        return [{ organization_id: organizationId }];
      }
      if (sql.includes('from "project_organizations"')) return w.organizationIds.map((id) => ({ organization_id: id }));
      if (sql.includes('from "project_loss_reasons"')) return [{ code: 'price' }];
      return [];
    },
    nativeDelete: async (entity: unknown, where: { organizationId?: string }) => {
      if (entity !== ProjectOrganization) return 0;
      const before = w.organizationIds.length;
      w.organizationIds = w.organizationIds.filter((id) => id !== where.organizationId);
      return before - w.organizationIds.length;
    },
    create: (entity: new () => object, data: Record<string, unknown>) => Object.assign(new entity(), data),
    persist: (row: Record<string, unknown>) => {
      pendingOutbox.push(row);
      return em;
    },
    remove: () => em,
    flush: async () => undefined,
  };
  em['transactional'] = async <T>(fn: (inner: EntityManager) => Promise<T>): Promise<T> => {
    const snapshot = { project: { ...w.project }, stages: w.stages.map((s) => ({ ...s })), organizationIds: [...w.organizationIds] };
    pendingAudits = [];
    pendingOutbox = [];
    try {
      const result = await fn(em as unknown as EntityManager);
      audits.push(...pendingAudits);
      outbox.push(...pendingOutbox);
      return result;
    } catch (error) {
      Object.assign(w.project, snapshot.project);
      w.stages.forEach((s, index) => Object.assign(s, snapshot.stages[index]));
      w.organizationIds = snapshot.organizationIds;
      throw error;
    }
  };
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = {
    recordWithin: (_em: unknown, entry: Record<string, unknown>) => {
      pendingAudits.push(entry);
      return {} as never;
    },
  } as unknown as AuditPort;
  const registry = sealedCommandHookRegistry({
    hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'projects', ...declaration })),
    moduleDependencies: { [HOOK_MODULE]: ['projects'] },
    hooks,
    ...(options.isPresent ? { isPresent: options.isPresent } : {}),
  });
  const bus = new CommandBus(orm, audit, new EventBus<Record<string, EventBase>>(), { hooks: registry });

  // Every Command the services hand the bus, and every child those run, as they ran.
  const commands: Array<Command<unknown>> = [];
  const capture = <T>(command: Command<T>): Command<T> => {
    commands.push(command as Command<unknown>);
    return {
      ...command,
      run: (ctx: CommandContext) =>
        command.run({ ...ctx, ...(ctx.run ? { run: <C>(child: Command<C>) => ctx.run!(capture(child)) } : {}) }),
    };
  };
  const capturingBus = { run: <T>(command: Command<T>) => bus.run(capture(command)) } as unknown as CommandBus;

  const afterCommitWork: string[] = [];
  const visible = () => ({
    id: w.project.id,
    number: w.project.number,
    title: w.project.title,
    description: w.project.description,
    state: w.project.state,
    current_stage_id: w.project.currentStageId ?? null,
    lost_stage_id: w.project.lostStageId ?? null,
    visibility: w.project.visibility,
    custom_field_values: { ...(w.project.customFieldValues ?? {}) },
    version: w.project.version,
    configuration_version: w.project.configurationVersion,
  });
  const access = {
    loadVisible: async () => visible(),
    assertVisibleUnderLock: async () => undefined,
    orgInScope: async () => true,
    inReachAfterWrite: async () => true,
  };
  const read = {
    timeZone: async () => 'Europe/Warsaw',
    afterWrite: async () => {
      afterCommitWork.push('afterWrite');
      return {};
    },
    entryAfterWrite: async () => ({ notes: [] }),
    graphOf: async () => ({
      graph: new StageGraph(w.stages, w.moves),
      stages: w.stages.map((s) => ({ id: s.id, position: s.position, completion_permitted: s.completionPermitted })),
    }),
  };
  const stageTasks = {
    gate: async () => [],
    planEntry: async () => ({ materialize: false, notes: [] }),
    materializeAfterCommit: async () => ({ createdTaskIds: [], failed: false }),
  };
  const tasks = { present: () => false };
  const projects = new ProjectService({
    emFactory: () => em as unknown as EntityManager,
    commandBus: capturingBus,
    access,
    read,
    organizations: { findByIds: async (ids: readonly string[]) => ids.map((id) => ({ id })) },
    adminUsers: { findByIds: async () => [] },
    tasks,
    templates: { forCopy: async () => null },
    stageTasks,
    references: { rowsFor: () => [] },
    mentions: { tell: async () => undefined },
    customFields: {
      validateAndMerge: async (_entity: string, current: Record<string, unknown>, patch: Record<string, unknown>) => ({
        ...current,
        ...patch,
      }),
    },
  } as unknown as ProjectServiceDeps);
  const moves = new MoveService({
    emFactory: () => em as unknown as EntityManager,
    commandBus: capturingBus,
    access,
    read,
    guards: { run: async () => undefined },
    stageTasks,
    tasks,
  } as unknown as MoveServiceDeps);

  return { w, audits, outbox, commands, projects, moves, afterCommitWork };
}

const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScopeActingFor(ADMIN_ID, 'projects unit test: hookable actions', fn);

/** The one Command of `ref`'s action the services ran, held to the ref (`command-hooks-api.md` §6). */
function expectDeclared(commands: ReadonlyArray<Command<unknown>>, ref: HookableActionRef<unknown, OutboxData>): void {
  const command = commands.find((candidate) => candidate.action === ref.action);
  expect(command, ref.action).toBeDefined();
  expectHookableCommand(command!, ref, { result: undefined, sentinels: [SENTINEL] });
}

/** Names, ids and codes only, in what a hook was handed and in every entry. */
function expectNoValues(calls: ReadonlyArray<{ data: unknown }>, audits: ReadonlyArray<Record<string, unknown>>): void {
  for (const call of calls) expect(JSON.stringify(call.data)).not.toContain(SENTINEL);
  for (const entry of audits) {
    expect(JSON.stringify(entry['stateAfter'] ?? null)).not.toContain(SENTINEL);
    for (const key of Object.keys((entry['stateAfter'] ?? {}) as Record<string, unknown>)) {
      if (key !== 'extensions') expect(PROJECTS_AUDIT_KEYS.has(key), key).toBe(true);
    }
  }
}

/** One recording `beforeCommit` hook and one no-op `afterCommit` handler on every declared action. */
function onEveryAction(then?: (ctx: CommandHookContext<unknown>) => Promise<void> | void) {
  const recording = recordingCommandHooks();
  const refs: ReadonlyArray<HookableActionRef<unknown, OutboxData>> = Object.values(PROJECTS);
  const entries: CommandHookEntry[] = refs.flatMap((ref) => [
    recording.on(ref, then ? { then } : {}),
    { id: `deliver-${ref.action.replace(/[._]+/g, '-')}`, on: ref, phase: 'afterCommit' as const, handler: async () => undefined },
  ]);
  return { recording, hooks: [{ moduleId: HOOK_MODULE, entries }] };
}

const createBody: CreateProjectBody = {
  title: `${SENTINEL}TITLE`,
  description: `${SENTINEL}DESCRIPTION`,
  organizationIds: [ORG_2, ORG_1],
  stages: [
    { name: `${SENTINEL}STAGE-1`, color: '#3b82f6' },
    { name: `${SENTINEL}STAGE-2`, color: '#22c55e' },
  ],
  customFieldValues: { investor: `${SENTINEL}CF`, budget_code: `${SENTINEL}CODE` },
} as CreateProjectBody;

describe('projects lists its hookable actions in its manifest', () => {
  it('lists the eight refs, for both phases', () => {
    expect(manifest.hookableActions?.map((declaration) => declaration.action)).toEqual(
      Object.values(PROJECTS).map((ref) => ref.action),
    );
  });
});

describe('a present hook runs on each declared action, with ids, codes and field names only', () => {
  it('projects.project.create — the new Project, its first Stage, its Organizations and the custom fields it was given', async () => {
    const { recording, hooks } = onEveryAction((ctx) => ctx.noteAuditChanges(['x_acme_erp_investor']));
    const h = harness(hooks);

    await asAdmin(() => h.projects.create(createBody, 'en'));

    expectDeclared(h.commands, PROJECTS.create);
    expect(recording.calls).toHaveLength(1);
    const [call] = recording.calls;
    expect(call).toMatchObject({ action: 'projects.project.create', extension: undefined });
    expect(call!.data).toEqual({
      projectId: call!.objectId,
      stageId: expect.any(String),
      templateId: TEMPLATE_FREE,
      organizationIds: [ORG_1, ORG_2],
      changedCustomFields: ['budget_code', 'investor'],
    });
    // The hook's noted write lands in the Project's one entry, by name.
    const entry = h.audits.find((candidate) => candidate['action'] === 'projects.project.create');
    expect(entry?.['stateAfter']).toMatchObject({ extensions: { [HOOK_MODULE]: { changedFields: ['x_acme_erp_investor'] } } });
    expectNoValues(recording.calls, h.audits);
  });

  it('projects.project.update and .custom_fields_update — the names of what changed, one Command each', async () => {
    const { recording, hooks } = onEveryAction();
    const h = harness(hooks);

    await asAdmin(() =>
      h.projects.update(
        PROJECT_ID,
        {
          version: 3,
          title: `${SENTINEL}RENAMED`,
          description: `${SENTINEL}DESCRIPTION`,
          startOn: '2026-12-01',
          customFieldValues: { investor: `${SENTINEL}CF-NEW` },
        },
        'en',
      ),
    );

    expectDeclared(h.commands, PROJECTS.update);
    expectDeclared(h.commands, PROJECTS.customFieldsUpdate);
    expect(recording.calls.map((call) => [call.action, call.data])).toEqual([
      // The description was sent unchanged, so it is not named.
      ['projects.project.update', { projectId: PROJECT_ID, changedFields: ['startOn', 'title'] }],
      ['projects.project.custom_fields_update', { projectId: PROJECT_ID, changedCustomFields: ['investor'] }],
    ]);
    expectNoValues(recording.calls, h.audits);
  });

  it('projects.project.organization_add and .organization_remove — one call per Organization of the set', async () => {
    const { recording, hooks } = onEveryAction();
    const h = harness(hooks);

    await asAdmin(() => h.projects.setOrganizations(PROJECT_ID, [ORG_2], 'en'));

    expectDeclared(h.commands, PROJECTS.organizationAdd);
    expectDeclared(h.commands, PROJECTS.organizationRemove);
    expect(recording.calls.map((call) => [call.action, call.data])).toEqual([
      ['projects.project.organization_add', { projectId: PROJECT_ID, targetOrganizationId: ORG_2, changed: true }],
      ['projects.project.organization_remove', { projectId: PROJECT_ID, targetOrganizationId: ORG_1, changed: true }],
    ]);
    expect(h.w.organizationIds).toEqual([ORG_2]);
  });

  it('projects.project.stage_move — the Stages left and entered, by id', async () => {
    const { recording, hooks } = onEveryAction();
    const h = harness(hooks);

    await asAdmin(() => h.moves.move(PROJECT_ID, { toStageId: STAGE_B, version: 3 }, 'en'));

    expectDeclared(h.commands, PROJECTS.stageMove);
    expect(recording.calls.map((call) => [call.action, call.data])).toEqual([
      ['projects.project.stage_move', { projectId: PROJECT_ID, fromStageId: STAGE_A, toStageId: STAGE_B }],
    ]);
    expectNoValues(recording.calls, h.audits);
  });

  it('projects.project.close — the outcome, the Stage and the loss reason by code, never the comment', async () => {
    const { recording, hooks } = onEveryAction();
    const h = harness(hooks);

    await asAdmin(() =>
      h.moves.close(
        PROJECT_ID,
        { outcome: 'lost', lossReasonId: LOSS_REASON_ID, comment: `${SENTINEL}COMMENT`, version: 3 },
        'en',
      ),
    );

    expectDeclared(h.commands, PROJECTS.close);
    expect(recording.calls.map((call) => [call.action, call.data])).toEqual([
      ['projects.project.close', { projectId: PROJECT_ID, state: 'lost', stageId: STAGE_A, lossReasonCode: 'price' }],
    ]);
    expectNoValues(recording.calls, h.audits);
  });

  it('projects.project.reopen — the Stage it went back into and how it had ended', async () => {
    const { recording, hooks } = onEveryAction();
    const h = harness(hooks, { state: 'lost' });

    await asAdmin(() => h.moves.reopen(PROJECT_ID, { version: 3 }, 'en'));

    expectDeclared(h.commands, PROJECTS.reopen);
    expect(recording.calls.map((call) => [call.action, call.data])).toEqual([
      ['projects.project.reopen', { projectId: PROJECT_ID, stageId: STAGE_A, previousState: 'lost' }],
    ]);
  });
});

describe("a hook whose module is switched off is skipped (Principle XVII)", () => {
  it('runs no hook, writes no outbox row and records no extension — the write behaves as if it were not installed', async () => {
    const { recording, hooks } = onEveryAction(() => {
      throw new Error('a switched-off hook ran');
    });
    const h = harness(hooks, { isPresent: (moduleId) => moduleId !== HOOK_MODULE });

    await asAdmin(() => h.projects.create(createBody, 'en'));
    await asAdmin(() => h.moves.move(PROJECT_ID, { toStageId: STAGE_B, version: 3 }, 'en'));
    await asAdmin(() => h.projects.setOrganizations(PROJECT_ID, [ORG_2], 'en'));

    expect(recording.calls).toEqual([]);
    expect(h.outbox).toEqual([]);
    expect(h.w.project.currentStageId).toBe(STAGE_B);
    expect(h.w.organizationIds).toEqual([ORG_2]);
    for (const entry of h.audits) expect(entry['stateAfter'] ?? {}).not.toHaveProperty('extensions');
  });
});

describe('a beforeCommit veto refuses the write with its own error and rolls it back', () => {
  const vetoed = Object.assign(new Error('The investor is not approved.'), { statusCode: 409, code: 'ACME_INVESTOR_REFUSED' });

  it('a stage move: the Project stays in its Stage at its version, and nothing is recorded', async () => {
    const { hooks } = onEveryAction(() => {
      throw vetoed;
    });
    const h = harness(hooks);

    const error = await asAdmin(() => h.moves.move(PROJECT_ID, { toStageId: STAGE_B, version: 3 }, 'en')).catch((e: unknown) => e);

    expect(error).toBe(vetoed);
    expect(h.w.project.currentStageId).toBe(STAGE_A);
    expect(h.w.project.version).toBe(3);
    expect(h.audits).toEqual([]);
    expect(h.outbox).toEqual([]);
    expect(h.afterCommitWork).toEqual([]);
  });

  it('one Organization of a set: the whole set stays as it was', async () => {
    const recording = recordingCommandHooks();
    const h = harness([
      {
        moduleId: HOOK_MODULE,
        entries: [
          recording.on(PROJECTS.organizationRemove, {
            then: () => {
              throw vetoed;
            },
          }),
        ],
      },
    ]);

    const error = await asAdmin(() => h.projects.setOrganizations(PROJECT_ID, [ORG_2], 'en')).catch((e: unknown) => e);

    expect(error).toBe(vetoed);
    // ORG_2 was added by the first child before the second was refused.
    expect(h.w.organizationIds).toEqual([ORG_1]);
    expect(h.w.project.configurationVersion).toBe(2);
    expect(h.audits).toEqual([]);
  });
});

describe('an afterCommit handler is delivered through the outbox', () => {
  it('gets one row per write, on the Command’s transaction, with the outbox data — none pinned to an Organization', async () => {
    const { hooks } = onEveryAction();
    const h = harness(hooks);

    await asAdmin(() => h.projects.setOrganizations(PROJECT_ID, [ORG_2], 'en'));
    await asAdmin(() => h.moves.move(PROJECT_ID, { toStageId: STAGE_B, version: 3 }, 'en'));
    await asAdmin(() => h.moves.close(PROJECT_ID, { outcome: 'completed', version: 4 }, 'en'));

    expect(
      h.outbox.map((row) => ({
        action: row['action'],
        objectId: row['objectId'],
        organizationId: row['organizationId'],
        hookModule: row['hookModule'],
        data: row['data'],
      })),
    ).toEqual([
      {
        action: 'projects.project.organization_add',
        objectId: PROJECT_ID,
        organizationId: null,
        hookModule: HOOK_MODULE,
        data: { projectId: PROJECT_ID, targetOrganizationId: ORG_2, changed: true },
      },
      {
        action: 'projects.project.organization_remove',
        objectId: PROJECT_ID,
        organizationId: null,
        hookModule: HOOK_MODULE,
        data: { projectId: PROJECT_ID, targetOrganizationId: ORG_1, changed: true },
      },
      {
        action: 'projects.project.stage_move',
        objectId: PROJECT_ID,
        organizationId: null,
        hookModule: HOOK_MODULE,
        data: { projectId: PROJECT_ID, fromStageId: STAGE_A, toStageId: STAGE_B },
      },
      {
        action: 'projects.project.close',
        objectId: PROJECT_ID,
        organizationId: null,
        hookModule: HOOK_MODULE,
        data: { projectId: PROJECT_ID, state: 'completed', stageId: STAGE_B, lossReasonCode: null },
      },
    ]);
    for (const row of h.outbox) expect(JSON.stringify(row['data'])).not.toContain(SENTINEL);
  });

  it('pins no row of any of the eight actions to an Organization: a Project has no single owner', async () => {
    const { hooks } = onEveryAction();
    const h = harness(hooks);
    await asAdmin(() => h.projects.create(createBody, 'en'));
    await asAdmin(() =>
      h.projects.update(PROJECT_ID, { version: 3, title: `${SENTINEL}RENAMED`, customFieldValues: { investor: 'x' } }, 'en'),
    );
    await asAdmin(() => h.projects.setOrganizations(PROJECT_ID, [ORG_2], 'en'));
    await asAdmin(() => h.moves.move(PROJECT_ID, { toStageId: STAGE_B, version: 5 }, 'en'));
    await asAdmin(() => h.moves.close(PROJECT_ID, { outcome: 'completed', version: 6 }, 'en'));
    await asAdmin(() => h.moves.reopen(PROJECT_ID, { version: 7 }, 'en'));

    expect(new Set(h.outbox.map((row) => row['action']))).toEqual(new Set(Object.values(PROJECTS).map((ref) => ref.action)));
    for (const row of h.outbox) expect(row['organizationId'], String(row['action'])).toBeNull();
  });

  it('writes no row for a write a beforeCommit hook refused', async () => {
    const recording = recordingCommandHooks();
    const h = harness([
      {
        moduleId: HOOK_MODULE,
        entries: [
          recording.on(PROJECTS.reopen, {
            then: () => {
              throw new Error('refused');
            },
          }),
          { id: 'deliver-reopen', on: PROJECTS.reopen, phase: 'afterCommit', handler: async () => undefined },
        ],
      },
    ], { state: 'completed' });

    await expect(asAdmin(() => h.moves.reopen(PROJECT_ID, { version: 3 }, 'en'))).rejects.toThrow('refused');

    expect(h.outbox).toEqual([]);
    expect(h.w.project.state).toBe('completed');
  });
});
