import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  TASKS_EVENTS,
  type SupportedLanguage,
  type TaskStatusCategory,
  type TaskStatusChangeBody,
  type TaskStatusChangedEvent,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { withCallerOptions, type CallerOptions } from '../commands/caller-options.js';
import { resolveTaskStatusName, type TaskStatusGraph } from '../domain/task-status-graph.js';
import { TaskStatus } from '../entities/task-status.entity.js';
import type { TaskAccess } from './task-access.js';
import { auditSnapshot, envelope, lockedTask } from './task-commands.js';
import type { TaskWorkflowRead } from './task-workflow-read.js';

export interface TaskTransitionServiceDeps {
  commandBus: CommandBus;
  access: Pick<TaskAccess, 'loadVisible' | 'assertMayChange'>;
  workflow: Pick<TaskWorkflowRead, 'graph'>;
}

/**
 * A move: the target code, and the status the caller read the Task in. The
 * route always sends `from`; `taskCommandPort.setStatus` may leave it out, and
 * then the status this service reads stands in for it
 * (`specs/186-aggregate-ports/` R-23.4). Neither is checked for its form: a
 * code the workflow does not hold is 422 `TASK_STATUS_UNKNOWN` from inside the
 * Command.
 */
export interface TaskStatusMoveInput {
  readonly to: string;
  readonly from?: string | undefined;
}

/** What a move did: `false` when the Task already was in the target status (nothing written). */
export interface AppliedTaskTransition {
  taskId: string;
  changed: boolean;
}

/** 422 `TASK_STATUS_UNKNOWN` — a code the workflow does not hold. */
export function taskStatusUnknown(code: string): HttpError {
  return new HttpError(422, ERROR_CODES.TASK_STATUS_UNKNOWN, `"${code}" is not a status of the workflow.`, {
    statusCode: code,
  });
}

/**
 * 409 `TASK_TRANSITION_FORBIDDEN` — naming the permitted next statuses (FR-015):
 * by code in `allowedTargets`, for a client to offer them, and by name in the
 * reader's language in `allowed`, which the translated sentence interpolates.
 * With none permitted the refusal carries the token `none_allowed`, whose
 * sentence says so instead of naming an empty list.
 */
export function transitionForbidden(graph: TaskStatusGraph, from: string, language: string): HttpError {
  const allowedTargets = graph.allowedTargets(from);
  const allowed = allowedTargets
    .map((code) => {
      const status = graph.get(code);
      return status ? resolveTaskStatusName(status, language) : code;
    })
    .join(', ');
  return new HttpError(
    409,
    ERROR_CODES.TASK_TRANSITION_FORBIDDEN,
    allowedTargets.length > 0
      ? `The workflow does not permit that move. The Task can move to: ${allowed}.`
      : 'The workflow does not permit any move from this status.',
    { allowedTargets, allowed, ...(allowedTargets.length === 0 ? { code: 'none_allowed' } : {}) },
  );
}

function transitionConflict(current: string): HttpError {
  return new HttpError(409, ERROR_CODES.TASK_TRANSITION_CONFLICT, 'The Task left that status in the meantime.', {
    current,
  });
}

/**
 * The one door through which a Task changes status
 * (`specs/165-task-management/` research R-1, FR-015, FR-017): the detail
 * screen's status control, and the board's drag and *Move to…* (User Story 3).
 *
 * 1. The Task, as the caller may see it (`TaskAccess.loadVisible`, else 404),
 *    and may change it (`assertMayChange`).
 * 2. One `tasks.task.status_change` Command, every check inside it, on its
 *    transaction:
 *    - the Task is locked and must still be in the caller's `from`, else 409
 *      `TASK_TRANSITION_CONFLICT`; already in `to` is a no-op, not audited;
 *    - the target status row is held **shared** until the move commits, so a
 *      configuration write that removes it or changes its category — which
 *      takes that row for itself first — either waits for this move and then
 *      finds the Task in the status, or has finished and this answers 422
 *      `TASK_STATUS_UNKNOWN`;
 *    - the workflow is read on that transaction: a code it does not hold is
 *      422, a move it does not permit is 409 `TASK_TRANSITION_FORBIDDEN`
 *      naming the permitted next statuses;
 *    - entering a `done`-category status records the completion time, leaving
 *      one clears it; `tasks.task.status_changed.v1` on commit.
 *
 * The system actor is not exempt: a move is a move whoever makes it.
 */
export class TaskTransitionService {
  constructor(private readonly deps: TaskTransitionServiceDeps) {}

  async apply(
    id: string,
    body: TaskStatusChangeBody | TaskStatusMoveInput,
    language: SupportedLanguage,
    caller: CallerOptions = {},
  ): Promise<AppliedTaskTransition> {
    const row = await this.deps.access.loadVisible(id);
    this.deps.access.assertMayChange(row);
    const to = String(body.to);
    const expected = body.from === undefined ? row.status : String(body.from);
    const workflow = this.deps.workflow;
    let applied: { from: string; draft: boolean; toCategory: TaskStatusCategory; context: Pick<TaskStatusChangedEvent, 'contextType' | 'contextId' | 'contextGroupId'> } | undefined;

    await this.deps.commandBus.run(withCallerOptions({
      action: 'tasks.task.status_change',
      objectType: 'task',
      objectId: row.id,
      run: async ({ em: commandEm }) => {
        const em = commandEm as EntityManager;
        const task = await lockedTask(em, row.id);
        const from = task.status;
        const target = await em.findOne(TaskStatus, { code: to }, { lockMode: LockMode.PESSIMISTIC_READ });
        if (!target) throw taskStatusUnknown(to);
        if (from === to) return { result: undefined, skipAudit: true };
        if (from !== expected) throw transitionConflict(from);
        const graph = await workflow.graph(em);
        if (!graph.canTransition(from, to)) throw transitionForbidden(graph, from, language);

        const before = auditSnapshot(task);
        task.status = to;
        if (target.category === 'done') task.completedAt = task.completedAt ?? new Date();
        else task.completedAt = null;
        applied = {
          from,
          draft: task.isDraft,
          toCategory: target.category,
          context: {
            contextType: task.contextType ?? null,
            contextId: task.contextId ?? null,
            contextGroupId: task.contextGroupId ?? null,
          },
        };
        return { result: undefined, before, after: auditSnapshot(task) };
      },
      event: () => {
        // A draft does not exist for other modules yet (research R-3).
        if (!applied || applied.draft) return undefined;
        const payload: TaskStatusChangedEvent = {
          ...envelope(),
          taskId: row.id,
          from: applied.from,
          to,
          toCategory: applied.toCategory,
          ...applied.context,
        };
        return { eventName: TASKS_EVENTS.STATUS_CHANGED, payload };
      },
    }, caller));
    return { taskId: row.id, changed: applied !== undefined };
  }
}
