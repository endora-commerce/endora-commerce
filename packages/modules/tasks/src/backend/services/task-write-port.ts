import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  calendarDateSchema,
  ERROR_CODES,
  TASK_CONTEXT_NOTE_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
  TASK_WRITE_PORT_BATCH_MAX,
  TaskContextSchema,
  NewContextTaskSchema,
  type AdminUserReadPort,
  type NewContextTask,
  type TaskContext,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { rethrowIfModuleDisabled, type AuditPort } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { withCallerOptions, type CallerOptions } from '../commands/caller-options.js';
import { Task } from '../entities/task.entity.js';
import { requireActingAdmin } from './task-access.js';
import { assertAssignable } from './task-checks.js';
import { createTaskCommand, deleteTaskCommand, type NewTaskFields } from './task-commands.js';
import type { TaskContextRegistry } from './task-context-registry.js';
import { taskContextInvalid } from './task-errors.js';
import type { TaskWorkflowRead } from './task-workflow-read.js';

/**
 * A context owner's writes — another module creating and deleting Tasks in a
 * context it owns (`specs/163-projects-and-tasks/contracts/ports-and-events.md`
 * §1): `taskCommandPort.createMany` and `.deleteInContext`, and the deprecated
 * `taskWritePort`, which delegates to them (`specs/186-aggregate-ports/`
 * R-23.7). The caller's `source` and `extensions` reach every Command through
 * `withCallerOptions`.
 *
 * `createMany` runs **one `tasks.task.create` Command per Task** under the
 * ambient actor, each starting in the workflow's current initial status
 * (`specs/165-task-management/` data-model §5) and published, so each Task has its own audit row and its own
 * `tasks.task.created.v1`.
 *
 * **Idempotent by source key** (R-19, issue #450). An entry with a
 * `sourceKey` the context already holds is not created again: the existing
 * Task's id stands in its place in `ids`, in input order, and the Task is left
 * as it is. A key repeated within one call is created once. Two calls racing
 * over the same keys are settled by the unique index on `(context_type,
 * context_id, source_key)`: the loser's Command fails on it, rolls back whole
 * (no audit row, no event), and the winner's id is answered — so a retry after
 * a failure part way through a batch creates only what is missing.
 *
 * Everything that can refuse the call — the batch
 * size, an entry's shape, the context's owner, an assignee — is checked
 * before the first Command runs, so a refused call writes nothing. The caller
 * calls it **after its own commit** (research R-8): each Command opens its own
 * transaction.
 *
 * The context's type must be registered by a **present** module; the port
 * does not ask whether the caller may see the id, because its caller is that
 * context's owner acting on its own record.
 *
 * Published with `providePort`: resolving it while `tasks` is off throws
 * `ModuleDisabledError` (503 `MODULE_DISABLED`).
 */
export interface TaskWritePortDeps {
  commandBus: CommandBus;
  emFactory: () => EntityManager;
  contexts: TaskContextRegistry;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
  workflow: TaskWorkflowRead;
  /** The kernel's audit port — a deleted Task's former sub-tasks each record why they lost their parent. */
  auditLog: AuditPort;
}

/** One entry as the Command writes it, and the group it overrides the call's with. */
type ValidEntry = Omit<NewTaskFields, 'status' | 'sourceKey'> & {
  contextGroupId: string | null | undefined;
  sourceKey: string | null;
};

function invalid(message: string): HttpError {
  return new HttpError(422, ERROR_CODES.VALIDATION_FAILED, message);
}

function validEntry(entry: NewContextTask, index: number): ValidEntry {
  const parsed = NewContextTaskSchema.safeParse(entry);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw invalid(`Task ${index + 1}: ${issue ? `${issue.path.join('.') || 'entry'} — ${issue.message}` : 'invalid'}.`);
  }
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  if (title.length < 1 || title.length > TASK_TITLE_MAX) {
    throw invalid(`Task ${index + 1}: a title has 1 to ${TASK_TITLE_MAX} characters.`);
  }
  const description = entry.description ?? '';
  if (description.length > TASK_DESCRIPTION_MAX) {
    throw invalid(`Task ${index + 1}: a description has at most ${TASK_DESCRIPTION_MAX} characters.`);
  }
  const contextNote = entry.contextNote ?? null;
  if (contextNote !== null && contextNote.length > TASK_CONTEXT_NOTE_MAX) {
    throw invalid(`Task ${index + 1}: a context note has at most ${TASK_CONTEXT_NOTE_MAX} characters.`);
  }
  const dueOn = entry.dueOn ?? null;
  if (dueOn !== null && !calendarDateSchema.safeParse(dueOn).success) {
    throw invalid(`Task ${index + 1}: a due date is a calendar date, YYYY-MM-DD.`);
  }
  return {
    title,
    description,
    assigneeIds: [...new Set(parsed.data.assigneeIds ?? [])],
    dueOn,
    contextNote,
    contextGroupId: parsed.data.contextGroupId,
    sourceKey: parsed.data.sourceKey ?? null,
  };
}

export class TaskWritePortService {
  constructor(private readonly deps: TaskWritePortDeps) {}

  /**
   * `created_by_admin_user_id` is not null, so with nobody behind the call it
   * is 403 before anything is read (R-23.2) — it used to be a plain `Error`
   * from inside the first Command.
   */
  async createMany(
    input: { context: TaskContext; tasks: NewContextTask[] },
    caller: CallerOptions = {},
  ): Promise<{ ids: string[] }> {
    requireActingAdmin('A Task is created by an administrator.');
    const parsed = TaskContextSchema.safeParse(input.context);
    if (!parsed.success) throw invalid('The context is not a context type and a uuid.');
    const context = parsed.data;
    if (input.tasks.length > TASK_WRITE_PORT_BATCH_MAX) {
      throw invalid(`At most ${TASK_WRITE_PORT_BATCH_MAX} Tasks are created in one call.`);
    }
    const tasks = input.tasks.map(validEntry);
    if (!this.deps.contexts.presentFor(context.contextType)) {
      throw taskContextInvalid(`No module that is switched on owns the Task context "${context.contextType}".`);
    }
    await assertAssignable(
      this.deps.adminUsers,
      tasks.flatMap((task) => task.assigneeIds),
    );
    const status = (await this.deps.workflow.graph()).initial().code;

    const keys = [...new Set(tasks.flatMap((task) => (task.sourceKey === null ? [] : [task.sourceKey])))];
    const known = await this.#heldKeys(context, keys);
    const ids: string[] = [];
    for (const { contextGroupId, sourceKey, ...task } of tasks) {
      const existing = sourceKey === null ? undefined : known.get(sourceKey);
      if (existing !== undefined) {
        ids.push(existing);
        continue;
      }
      const where = contextGroupId === undefined ? context : { ...context, contextGroupId };
      let id: string;
      try {
        id = await this.deps.commandBus.run(
          withCallerOptions(createTaskCommand(where, { ...task, status, sourceKey }), caller),
        );
      } catch (error) {
        rethrowIfModuleDisabled(error);
        // Another call created this key meanwhile: the unique index refused
        // this one, whose Command rolled back whole. Its Task is the answer.
        if (sourceKey === null || !(error instanceof UniqueConstraintViolationException)) throw error;
        const winner = (await this.#heldKeys(context, [sourceKey])).get(sourceKey);
        if (winner === undefined) throw error;
        id = winner;
      }
      if (sourceKey !== null) known.set(sourceKey, id);
      ids.push(id);
    }
    return { ids };
  }

  /** Which of `keys` the context already holds, and the id of the Task holding each. */
  async #heldKeys(context: TaskContext, keys: readonly string[]): Promise<Map<string, string>> {
    if (keys.length === 0) return new Map();
    const rows = (await this.deps.emFactory().execute(
      `select "id", "source_key" from "tasks"
        where "context_type" = ? and "context_id" = ? and "source_key" in (${keys.map(() => '?').join(', ')})`,
      [context.contextType, context.contextId, ...keys],
    )) as Array<{ id: string; source_key: string }>;
    return new Map(rows.map((row) => [row.source_key, row.id]));
  }

  async deleteInContext(
    q: { contextType: string; contextId: string },
    caller: CallerOptions = {},
  ): Promise<{ deleted: number }> {
    const parsed = TaskContextSchema.safeParse({ contextType: q.contextType, contextId: q.contextId });
    if (!parsed.success) throw invalid('The context is not a context type and a uuid.');
    const doomed = await this.deps.emFactory().find(
      Task,
      { contextType: q.contextType, contextId: q.contextId },
      { fields: ['id'], orderBy: { createdAt: 'asc' } },
    );
    let deleted = 0;
    for (const { id } of doomed) {
      const run = await this.deps.commandBus.run(withCallerOptions(deleteTaskCommand(id, this.deps.auditLog), caller));
      if (run.deleted) deleted += 1;
    }
    return { deleted };
  }
}
