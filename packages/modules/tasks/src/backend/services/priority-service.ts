import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  TASK_STATUS_REASSIGN_MAX,
  type CreateTaskPriorityBody,
  type TaskPriorityConfig,
  type UpdateTaskPriorityBody,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { TaskPriority } from '../entities/task-priority.entity.js';
import { heldIds, holdTasksFor, recordReassignments } from './task-reassignment.js';
import type { TaskVisibility } from './task-visibility.js';
import type { TaskWorkflowRead } from './task-workflow-read.js';

export interface TaskPriorityServiceDeps {
  emFactory: () => EntityManager;
  workflow: Pick<TaskWorkflowRead, 'priorities'>;
  visibility: Pick<TaskVisibility, 'condition'>;
  commandBus: CommandBus;
  /** The kernel's audit port: one `tasks.task.priority_change` row per Task a removal moves. */
  auditLog: AuditPort;
}

/**
 * The refusals of a priority write, under the workflow's code and its `rule`
 * detail — the priority list is "the same shape as statuses"
 * (`contracts/admin-api.md` §4):
 * - `priority_code_taken` — a priority with that code exists;
 * - `priority_replacement_required` — Tasks hold the priority being removed,
 *   and neither another priority nor `none` was named for them (FR-024).
 */
export type TaskPriorityConfigRule = 'priority_code_taken' | 'priority_replacement_required';

function priorityInvalid(rule: TaskPriorityConfigRule, message: string): HttpError {
  return new HttpError(422, ERROR_CODES.TASK_WORKFLOW_INVALID, message, { rule, code: rule });
}

function priorityNotFound(code: string): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, `Task priority "${code}" not found.`, { priorityCode: code });
}

function snapshot(priority: TaskPriority): Record<string, unknown> {
  return {
    code: priority.code,
    name: priority.name,
    defaultName: priority.defaultName,
    weight: priority.weight,
    color: priority.color,
  };
}

/** The `replacement` that clears the priority of the Tasks holding a removed one. */
export const NO_PRIORITY = 'none';

/**
 * The unknown priority code travels as `details.priorityCode`, never as
 * `details.code`: the envelope reads `details.code` as a refusal token that
 * picks the sentence, and an operator-configured code is not one (issue #569).
 */
export function priorityUnknown(code: string): HttpError {
  return new HttpError(422, ERROR_CODES.TASK_PRIORITY_UNKNOWN, `"${code}" is not a configured priority.`, {
    priorityCode: code,
  });
}

/**
 * The operator's priority list (`specs/165-task-management/` FR-009, FR-024,
 * research R-9; `contracts/admin-api.md` §4) — read from User Story 1 on,
 * configured from User Story 9 on.
 *
 * A Task holds a priority by its code. **The in-use count the list shows** is
 * the number of Tasks the caller may see holding it — the count composes the
 * visibility pre-filter, so a count says nothing of a Task the caller may not
 * see.
 *
 * **Every write is one Command** against `task_priority` and the code
 * (Constitution XIII). **Removing a priority in use moves its Tasks** to the
 * replacement the operator names, or clears it (`none`) — every Task holding
 * it, platform-wide, whoever may see it (drafts and private Tasks included):
 * the priority is configuration, and that is not a write on any one Task, so
 * no Task's own guards are asked. Each move is a `tasks.task.priority_change`
 * row in that Task's history with `reason: 'priority_removed'`, on the
 * removal's transaction ({@link holdTasksFor}, shared with the status
 * removal). At most {@link TASK_STATUS_REASSIGN_MAX} Tasks move in one
 * removal.
 */
export class TaskPriorityService {
  constructor(private readonly deps: TaskPriorityServiceDeps) {}

  /** `GET /tasks/priorities` — by weight, most urgent first. */
  async list(): Promise<TaskPriorityConfig[]> {
    const [priorities, inUse] = await Promise.all([this.deps.workflow.priorities(), this.#inUse()]);
    return priorities.map((priority) => ({
      code: priority.code,
      name: priority.name,
      defaultName: priority.defaultName,
      color: priority.color,
      weight: priority.weight,
      inUseCount: inUse.get(priority.code) ?? 0,
    }));
  }

  /** `POST /tasks/priorities` — answers the list as it stands afterwards. */
  async create(input: CreateTaskPriorityBody): Promise<TaskPriorityConfig[]> {
    await this.deps.commandBus.run({
      action: 'tasks.priority.create',
      objectType: 'task_priority',
      objectId: input.code,
      run: async ({ em: commandEm }) => {
        const em = commandEm as EntityManager;
        if (await em.findOne(TaskPriority, { code: input.code })) {
          throw priorityInvalid('priority_code_taken', `A priority with the code "${input.code}" already exists.`);
        }
        const priority = em.create(TaskPriority, {
          code: input.code,
          name: { ...input.name },
          defaultName: input.name.en,
          color: input.color,
          weight: input.weight,
        });
        return { result: undefined, before: null, after: snapshot(priority) };
      },
    });
    return this.list();
  }

  /** `PATCH /tasks/priorities/:code` — names, colour, position. The code is immutable. */
  async update(code: string, patch: UpdateTaskPriorityBody): Promise<TaskPriorityConfig[]> {
    await this.deps.commandBus.run({
      action: 'tasks.priority.update',
      objectType: 'task_priority',
      objectId: code,
      run: async ({ em: commandEm }) => {
        const priority = await this.#locked(commandEm as EntityManager, code);
        const before = snapshot(priority);
        if (patch.name !== undefined) {
          priority.name = { ...patch.name };
          priority.defaultName = patch.name.en;
        }
        if (patch.color !== undefined) priority.color = patch.color;
        if (patch.weight !== undefined) priority.weight = patch.weight;
        return { result: undefined, before, after: snapshot(priority) };
      },
    });
    return this.list();
  }

  /**
   * `DELETE /tasks/priorities/:code?replacement=` (FR-024). While Tasks hold
   * the priority, `replacement` names the one they get, or `none` — else 422
   * `TASK_WORKFLOW_INVALID {rule: 'priority_replacement_required'}`; an unknown
   * replacement is 422 `TASK_PRIORITY_UNKNOWN`. Above
   * {@link TASK_STATUS_REASSIGN_MAX} Tasks, 409 `TASK_STATUS_IN_USE_TOO_MANY`
   * and nothing moves.
   */
  async delete(code: string, replacement: string | undefined): Promise<TaskPriorityConfig[]> {
    await this.deps.commandBus.run({
      action: 'tasks.priority.delete',
      objectType: 'task_priority',
      objectId: code,
      run: async ({ em: commandEm }) => {
        const em = commandEm as EntityManager;
        const priority = await this.#locked(em, code);
        const held = await holdTasksFor(em, 'priority_code', code, {
          message: `More than ${TASK_STATUS_REASSIGN_MAX} Tasks have the priority "${code}". Change some of them first.`,
          // `code` keys the sentence: the status removal's code, said of a priority.
          details: { priorityCode: code, code: 'priority' },
        });

        let moved = 0;
        if (held.length > 0) {
          if (replacement === undefined || replacement === code) {
            throw priorityInvalid(
              'priority_replacement_required',
              `Tasks have the priority "${code}": name the priority they get, or none.`,
            );
          }
          const target = replacement === NO_PRIORITY ? null : replacement;
          // The replacement is held until this commits: it cannot be removed under the move.
          if (target !== null && !(await em.findOne(TaskPriority, { code: target }, { lockMode: LockMode.PESSIMISTIC_WRITE }))) {
            throw priorityUnknown(target);
          }
          await em.execute(`update "tasks" set "priority_code" = ?, "updated_at" = ? where "id" = any(?::uuid[])`, [
            target,
            new Date(),
            heldIds(held),
          ]);
          recordReassignments(this.deps.auditLog, em, held, 'tasks.task.priority_change', () => ({
            before: { priorityCode: code },
            after: { priorityCode: target, reason: 'priority_removed' },
          }));
          moved = held.length;
        }
        const before = { ...snapshot(priority), ...(moved > 0 ? { replacement, moved } : {}) };
        em.remove(priority);
        return { result: undefined, before, after: null };
      },
    });
    return this.list();
  }

  /** A code the list holds — else 422 `TASK_PRIORITY_UNKNOWN`. `null` (no priority) always passes. */
  async assertKnown(code: string | null): Promise<void> {
    if (code === null) return;
    const priorities = await this.deps.workflow.priorities();
    if (!priorities.some((priority) => priority.code === code)) throw priorityUnknown(code);
  }

  /** The priority row, locked for this Command. */
  async #locked(em: EntityManager, code: string): Promise<TaskPriority> {
    const priority = await em.findOne(TaskPriority, { code }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    if (!priority) throw priorityNotFound(code);
    return priority;
  }

  async #inUse(): Promise<Map<string, number>> {
    const visible = await this.deps.visibility.condition('t');
    const rows = (await this.deps.emFactory().execute(
      `select t."priority_code", count(*)::int as "n" from "tasks" t
        where t."priority_code" is not null ${visible ? `and ${visible.sql}` : ''}
        group by t."priority_code"`,
      visible?.params ?? [],
    )) as Array<{ priority_code: string; n: number }>;
    return new Map(rows.map((row) => [row.priority_code, Number(row.n)]));
  }
}
