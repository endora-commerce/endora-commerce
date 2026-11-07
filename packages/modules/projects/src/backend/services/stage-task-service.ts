import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type NewContextTask,
  type ProjectStage as ProjectStageView,
  type ProjectStageEntryNote,
  type ProjectTasksResponse,
  type StageTaskDefinition,
  type SupportedLanguage,
  type TaskRecord,
  type TaskSummary,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { ModuleDisabledError, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { addDays, todayIn } from '../domain/deadline.js';
import { ProjectStage } from '../entities/project-stage.entity.js';
import { ProjectStageEntry } from '../entities/project-stage-entry.entity.js';
import { ProjectStageTask } from '../entities/project-stage-task.entity.js';
import { TASKS_READ_PERMISSION } from './owner-read-permissions.js';
import { uuidArray, type ProjectAccess } from './project-access.js';
import { personName, type ProjectReadService } from './project-read-service.js';
import { assertRolesExist, lockProject, lockProjectRow } from './project-service.js';
import { lockRolesForWrite } from './role-locks.js';
import { PROJECT_TASK_CONTEXT_TYPE, type ProjectTasks } from './project-tasks.js';
import { stageNotFound } from './stage-service.js';
import { responsibleRoleNote } from './task-context-descriptor.js';

/**
 * Stage Tasks and the completion gate (research R-7, R-8; FR-012, FR-017,
 * FR-040) — everything a Project does with the Tasks module, which it may have
 * to do without.
 *
 * - **Definitions.** A Stage's own Task definitions, replaced whole by one
 *   Command (`projects.project.stage_tasks_set`), at most 100. Kept whatever
 *   the Tasks module's state: they apply again once it is on.
 * - **The gate.** Leaving a Stage whose gate is on, or completing the Project
 *   from it, is refused while one of its Tasks is neither done nor cancelled —
 *   409 `PROJECT_STAGE_GATE_OPEN_TASKS` counting them (naming them to a
 *   reader of Tasks). With Tasks off the gate
 *   is not applied and the entry records `gate_not_applied_tasks_off`.
 * - **Materialisation.** On entering a Stage that has definitions and has never
 *   had them created or skipped: with Tasks on, the move's own Command stamps
 *   `tasks_materialized_at` and, **after it commits**, this service asks
 *   `taskWritePort.createMany` for them — one `tasks.task.create` Command per
 *   Task, audited by the Tasks module on behalf of the administrator who
 *   moved. With Tasks off the move stamps `tasks_skipped_at` and notes
 *   `stage_tasks_skipped`. Both stamps are terminal: re-entering never creates
 *   them again. A Stage without definitions is stamped neither way — there is
 *   nothing to create — so definitions added to it later are created the next
 *   time it is entered.
 * - **Failure.** If creating them fails the Stage stays entered, the stamp is
 *   withdrawn and the entry records `tasks_materialize_failed`
 *   (`projects.project.stage_tasks_failed`); `POST …/materialize-tasks` then
 *   creates them once (`projects.project.stage_tasks_retry`), and refuses with
 *   409 `PROJECT_STAGE_TASKS_NOT_RETRYABLE` otherwise.
 * - **No duplicates** (`specs/165-task-management/` R-19, issue #450). A
 *   failure can come part way through — `createMany` commits one Task at a
 *   time — so each Task carries its definition's id as its `sourceKey`, and
 *   `createMany` answers the Task an earlier attempt created for a key instead
 *   of creating another. A retry therefore creates only what is missing, however
 *   many earlier attempts failed and wherever. The retry's claim (the stamp,
 *   under the Project's lock) stays: it is what answers a second retry at once
 *   with 409 rather than with a second, redundant pass, and the source key is
 *   what makes a pass that does run harmless.
 *
 * Every Project is loaded through `ProjectAccess.loadVisible`, or was by the
 * caller that hands its id here; Stages, definitions and Members are read by
 * that id only.
 */

export interface StageTaskServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  access: ProjectAccess;
  read: ProjectReadService;
  tasks: ProjectTasks;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
}

/** What a Stage entry decided about its Stage Tasks, inside the move's Command. */
export interface StageEntryPlan {
  /** Create the Stage's Tasks once the move has committed. */
  materialize: boolean;
  notes: ProjectStageEntryNote[];
}

const NOTHING_PLANNED: StageEntryPlan = { materialize: false, notes: [] };

function definitionSnapshot(task: ProjectStageTask): Record<string, unknown> {
  // Titles are the Stage's structure; a description is free text and travels
  // as its length only (the audit trail is not tenant-scoped).
  return {
    title: task.title,
    descriptionLength: task.description.length,
    responsibleRoleId: task.responsibleRoleId ?? null,
    dueOffsetDays: task.dueOffsetDays,
    position: task.position,
  };
}

function notRetryable(): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.PROJECT_STAGE_TASKS_NOT_RETRYABLE,
    'There is nothing to create again for this stage.',
  );
}

export class StageTaskService {
  constructor(private readonly deps: StageTaskServiceDeps) {}

  /** `PUT /projects/:id/stages/:stageId/tasks` — the Stage's definitions, replaced whole. */
  async setDefinitions(projectId: string, stageId: string, tasks: readonly StageTaskDefinition[]): Promise<ProjectStageView> {
    const visible = await this.deps.access.loadVisible(projectId);
    const roleIds = tasks.map((task) => task.responsibleRoleId).filter((id): id is string => typeof id === 'string');
    await assertRolesExist(this.deps.emFactory(), roleIds);
    await this.deps.commandBus.run({
      action: 'projects.project.stage_tasks_set',
      objectType: 'project',
      objectId: visible.id,
      run: async ({ em }) => {
        await lockProject(em, this.deps.access, visible.id);
        // Issue #453 — the Roles it names, held against a delete and asked again.
        await lockRolesForWrite(em as EntityManager, roleIds);
        const stage = await em.findOne(ProjectStage, { id: stageId, projectId: visible.id });
        if (!stage) throw stageNotFound();
        const previous = await em.find(ProjectStageTask, { stageId }, { orderBy: { position: 'asc', id: 'asc' } });
        const before = { stageId, tasks: previous.map(definitionSnapshot) };
        await em.nativeDelete(ProjectStageTask, { stageId });
        const written = tasks.map((task, index) =>
          em.create(ProjectStageTask, {
            stageId,
            title: task.title,
            description: task.description ?? '',
            responsibleRoleId: task.responsibleRoleId ?? null,
            dueOffsetDays: task.dueOffsetDays,
            position: index + 1,
          }),
        );
        return { result: null, before, after: { stageId, tasks: written.map(definitionSnapshot) } };
      },
    });
    return this.deps.read.stageAfterWrite(visible.id, stageId);
  }

  /**
   * The completion gate of the Stage being left (FR-012) — the module's own
   * first guard, asked before the registered ones. Throws 409 counting the open
   * Tasks — and naming them only to a caller who holds `tasks:read`, since a
   * move needs `projects:write` alone (T144 F2); answers the note to record
   * when the gate could not be applied.
   */
  async gate(projectId: string, stage: { id: string; completion_gate: boolean }): Promise<ProjectStageEntryNote[]> {
    if (!stage.completion_gate) return [];
    if (!this.deps.tasks.present()) return ['gate_not_applied_tasks_off'];
    const open = await this.deps.tasks.read.listOpenInContext({
      contextType: PROJECT_TASK_CONTEXT_TYPE,
      contextId: projectId,
      contextGroupId: stage.id,
    });
    if (open.length === 0) return [];
    const mayReadTasks = await this.deps.access.callerHolds(TASKS_READ_PERMISSION);
    throw new HttpError(
      409,
      ERROR_CODES.PROJECT_STAGE_GATE_OPEN_TASKS,
      'The project cannot leave this stage while some of its tasks are neither done nor cancelled.',
      {
        openTaskCount: open.length,
        ...(mayReadTasks
          ? { openTasks: open.map((task) => ({ id: task.id, number: task.number, title: task.title })) }
          : {}),
      },
    );
  }

  /**
   * Inside the move's Command, on entering `stage`: claim its Stage Tasks
   * (Tasks on) or mark them skipped (Tasks off). `tasksPresent` is decided by
   * the caller before the Command, never inside a `catch`.
   */
  async planEntry(em: EntityManager, stage: ProjectStage, tasksPresent: boolean): Promise<StageEntryPlan> {
    if (stage.tasksMaterializedAt || stage.tasksSkippedAt) return NOTHING_PLANNED;
    const definitions = await em.count(ProjectStageTask, { stageId: stage.id });
    if (definitions === 0) return NOTHING_PLANNED;
    if (!tasksPresent) {
      stage.tasksSkippedAt = new Date();
      return { materialize: false, notes: ['stage_tasks_skipped'] };
    }
    stage.tasksMaterializedAt = new Date();
    return { materialize: true, notes: [] };
  }

  /**
   * After the move committed: create the Stage's Tasks. A failure is recorded
   * on the entry and answered, never thrown — the move happened.
   */
  async materializeAfterCommit(
    projectId: string,
    stageId: string,
    entryId: string,
  ): Promise<{ createdTaskIds: string[]; failed: boolean }> {
    try {
      return { createdTaskIds: await this.#create(projectId, stageId), failed: false };
    } catch (error) {
      await this.#recordFailure(projectId, stageId, entryId);
      rethrowIfModuleDisabled(error);
      console.warn('projects: the Stage Tasks of a committed move could not be created', {
        projectId,
        stageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { createdTaskIds: [], failed: true };
    }
  }

  /**
   * `POST /projects/:id/stages/:stageId/materialize-tasks` — once, after a
   * recorded failure. `created` counts the Stage's Tasks once it has run, those
   * an earlier attempt created included: `createMany` answers their ids too.
   */
  async retry(projectId: string, stageId: string): Promise<{ created: number }> {
    const visible = await this.deps.access.loadVisible(projectId);
    if (!this.deps.tasks.present()) throw new ModuleDisabledError('tasks');
    const entryId = await this.deps.commandBus.run({
      action: 'projects.project.stage_tasks_retry',
      objectType: 'project',
      objectId: visible.id,
      run: async ({ em }) => {
        await lockProject(em, this.deps.access, visible.id);
        const stage = await em.findOne(ProjectStage, { id: stageId, projectId: visible.id });
        if (!stage) throw stageNotFound();
        if (stage.tasksMaterializedAt || stage.tasksSkippedAt) throw notRetryable();
        const [last] = await em.find(
          ProjectStageEntry,
          { projectId: visible.id, toStageId: stageId },
          { orderBy: { at: 'desc', id: 'desc' }, limit: 1 },
        );
        if (!last || !last.notes.includes('tasks_materialize_failed')) throw notRetryable();
        stage.tasksMaterializedAt = new Date();
        return { result: last.id, before: { stageId, entryId: last.id }, after: { stageId, entryId: last.id } };
      },
    });
    try {
      return { created: (await this.#create(visible.id, stageId)).length };
    } catch (error) {
      await this.#recordFailure(visible.id, stageId, entryId);
      throw error;
    }
  }

  /**
   * `GET /projects/:id/tasks` — the Project's Tasks by Stage, in Stage order.
   * `tasksAvailable: false` while Tasks is off, or for a reader who may not
   * read Tasks (`tasks:read` — the Tasks module's own gate). A status is named
   * as the Tasks workflow names it, in `language`; *closed* is the record's own
   * `closed` (`specs/165-task-management/` research R-1).
   */
  async tasksByStage(projectId: string, language: SupportedLanguage): Promise<ProjectTasksResponse> {
    const visible = await this.deps.access.loadVisible(projectId);
    if (!this.deps.tasks.present() || !(await this.deps.access.callerHolds('tasks:read'))) {
      return { tasksAvailable: false, stages: [] };
    }
    const records = await this.deps.tasks.read.listInContext({
      contextType: PROJECT_TASK_CONTEXT_TYPE,
      contextId: visible.id,
    });
    const { stages } = await this.deps.read.graphOf(visible.id);
    const today = todayIn(await this.deps.read.timeZone());
    const assigneeIds = [...new Set(records.flatMap((r) => r.assigneeIds))];
    const people = new Map(
      (assigneeIds.length > 0 ? await this.deps.adminUsers.findByIds(assigneeIds) : []).map((a) => [a.id, a]),
    );
    const now = new Date();
    const summary = (record: TaskRecord, stageName: string): TaskSummary => {
      return {
        id: record.id,
        number: record.number,
        title: record.title,
        status: {
          code: record.status,
          name: record.statusName[language] || record.statusDefaultName,
          color: record.statusColor,
          category: record.statusCategory,
        },
        closed: record.closed,
        dueOn: record.dueOn,
        dueAt: record.dueAt ? record.dueAt.toISOString() : null,
        overdue: !record.closed && (record.dueAt ? now > record.dueAt : record.dueOn !== null && record.dueOn < today),
        assignees: record.assigneeIds.flatMap((id) => {
          const person = people.get(id);
          return person
            ? [{ id: person.id, name: personName(person), active: person.status === 'active' && person.deletedAt === null }]
            : [];
        }),
        // The Tasks tab shows none of these; the Tasks module's own screens do.
        priority: null,
        tags: [],
        parent: null,
        subtasks: { closed: 0, total: 0 },
        draft: record.draft,
        private: record.private,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        context: {
          type: PROJECT_TASK_CONTEXT_TYPE,
          available: true,
          label: `${visible.number} ${visible.title}`,
          href: `/projects/${visible.id}`,
          groupLabel: stageName,
        },
      };
    };
    // A Task whose Stage is gone (deleted while Tasks was off) belongs to no
    // Stage the Project shows until the Tasks module's maintenance pass takes
    // the Stage off it (#450); it stays readable in the Tasks module.
    return {
      tasksAvailable: true,
      stages: stages.map((stage) => ({
        stageId: stage.id,
        tasks: records.filter((r) => r.contextGroupId === stage.id).map((r) => summary(r, stage.name)),
      })),
    };
  }

  /** The Tasks a Stage's definitions become, and `createMany` for them. */
  async #create(projectId: string, stageId: string): Promise<string[]> {
    const tasks = await this.#newTasks(projectId, stageId);
    if (tasks.length === 0) return [];
    const { ids } = await this.deps.tasks.write.createMany({
      context: { contextType: PROJECT_TASK_CONTEXT_TYPE, contextId: projectId, contextGroupId: stageId },
      tasks,
    });
    return ids;
  }

  /**
   * Each definition as a Task: due the Stage's start plus its offset; assigned
   * to the one active Member holding its Role, or else unassigned with the
   * Role named in the Task's note (R-8). The note is stored as the Role
   * (`responsibleRoleNote`) and worded per reader by the `project` context's
   * `renderNote`.
   */
  async #newTasks(projectId: string, stageId: string): Promise<NewContextTask[]> {
    const em = this.deps.emFactory();
    const [stage] = (await em.execute(
      `select to_char(s."started_on", 'YYYY-MM-DD') as "started_on" from "project_stages" s
        where s."id" = ? and s."project_id" = ?`,
      [stageId, projectId],
    )) as Array<{ started_on: string | null }>;
    if (!stage) return [];
    const definitions = (await em.execute(
      `select t."id", t."title", t."description", t."responsible_role_id", t."due_offset_days"
         from "project_stage_tasks" t where t."stage_id" = ? order by t."position", t."id"`,
      [stageId],
    )) as Array<{ id: string; title: string; description: string; responsible_role_id: string | null; due_offset_days: number }>;
    if (definitions.length === 0) return [];

    const roleIds = [...new Set(definitions.map((d) => d.responsible_role_id).filter((id): id is string => id !== null))];
    const holders = roleIds.length
      ? ((await em.execute(
          `select mr."role_id", m."admin_user_id" from "project_member_roles" mr
             join "project_members" m on m."id" = mr."member_id"
            where m."project_id" = ? and mr."role_id" = any(?::uuid[])`,
          [projectId, uuidArray(roleIds)],
        )) as Array<{ role_id: string; admin_user_id: string }>)
      : [];
    const active = new Set(
      (holders.length > 0
        ? await this.deps.adminUsers.findByIds([...new Set(holders.map((h) => h.admin_user_id))], { activeOnly: true })
        : []
      )
        .filter((admin) => admin.status === 'active' && admin.deletedAt === null)
        .map((admin) => admin.id),
    );
    const startedOn = stage.started_on;
    return definitions.map((definition) => {
      const roleId = definition.responsible_role_id;
      const held = roleId ? holders.filter((h) => h.role_id === roleId && active.has(h.admin_user_id)) : [];
      const assignee = held.length === 1 ? held[0]!.admin_user_id : null;
      return {
        title: definition.title,
        description: definition.description,
        dueOn: startedOn === null ? null : addDays(startedOn, definition.due_offset_days),
        assigneeIds: assignee === null ? [] : [assignee],
        contextNote: roleId && assignee === null ? responsibleRoleNote(roleId) : null,
        // The definition's id: a retry creates only the Tasks still missing (#450).
        sourceKey: definition.id,
      };
    });
  }

  /** The Stage stays entered; its claim is withdrawn and the entry says why. */
  async #recordFailure(projectId: string, stageId: string, entryId: string): Promise<void> {
    await this.deps.commandBus.run({
      action: 'projects.project.stage_tasks_failed',
      objectType: 'project',
      objectId: projectId,
      run: async ({ em }) => {
        await lockProjectRow(em, projectId);
        const stage = await em.findOne(ProjectStage, { id: stageId, projectId });
        if (stage) stage.tasksMaterializedAt = null;
        const entry = await em.findOne(ProjectStageEntry, { id: entryId, projectId });
        if (entry && !entry.notes.includes('tasks_materialize_failed')) {
          entry.notes = [...entry.notes, 'tasks_materialize_failed'];
        }
        return { result: null, before: { stageId, entryId }, after: { stageId, entryId, note: 'tasks_materialize_failed' } };
      },
    });
  }
}
