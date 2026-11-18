import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  TASK_STATUS_REASSIGN_MAX,
  type CreateTaskStatusBody,
  type ReorderTaskStatusesBody,
  type SetTaskTransitionsBody,
  type SupportedLanguage,
  type UpdateTaskStatusBody,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { TaskWorkflowConfigError, type TaskWorkflowRule } from '../domain/task-status-graph.js';
import { TaskStatus } from '../entities/task-status.entity.js';
import { TaskStatusTransition } from '../entities/task-status-transition.entity.js';
import { REORDER_WEIGHT_STEP, assertCompleteOrder } from './reorder.js';
import { heldIds, holdTasksFor, recordReassignments, type HeldTask } from './task-reassignment.js';
import { taskStatusUnknown, transitionForbidden } from './task-transition-service.js';
import type { TaskWorkflowRead } from './task-workflow-read.js';

/**
 * The refusals of a configuration write that are not FR-013 rules of the graph
 * itself, under the same code and the same `rule` detail
 * (`specs/165-task-management/` contracts/admin-api.md §4):
 * - `status_code_taken` — a status with that code exists;
 * - `category_in_use` — Tasks are in the status, and what it means would
 *   change under them (CRM's rule for its kinds);
 * - `replacement_required` — Tasks are in the status being removed, and no
 *   other status was named to take them (FR-016).
 */
export type TaskWorkflowConfigRule = TaskWorkflowRule | 'status_code_taken' | 'category_in_use' | 'replacement_required';

/** 422 `TASK_WORKFLOW_INVALID`, the rule both where a client reads it and as the sentence's token. */
function workflowInvalid(rule: TaskWorkflowConfigRule, message: string): HttpError {
  return new HttpError(422, ERROR_CODES.TASK_WORKFLOW_INVALID, message, { rule, code: rule });
}

function statusNotFound(code: string): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, `Task status "${code}" not found.`, { statusCode: code });
}

function snapshot(status: TaskStatus): Record<string, unknown> {
  return {
    code: status.code,
    name: status.name,
    defaultName: status.defaultName,
    category: status.category,
    isInitial: status.isInitial,
    weight: status.weight,
    color: status.color,
  };
}

/** The audited object of a change to the moves: the workflow's one set of them. */
const TRANSITIONS_OBJECT = { objectType: 'task_workflow', objectId: 'transitions' } as const;

export interface TaskWorkflowConfigServiceDeps {
  commandBus: CommandBus;
  workflow: Pick<TaskWorkflowRead, 'graph'>;
  /** The kernel's audit port: one `tasks.task.status_change` row per Task a removal moves (T001 (a)). */
  auditLog: AuditPort;
}

/**
 * Writes to the Task workflow (`specs/165-task-management/` FR-012 – FR-016,
 * research R-1; CRM's `workflow-config-service.ts`, the model).
 *
 * **Every write is one Command** (Constitution XIII) and **ends by holding the
 * whole workflow to FR-013** on its own transaction: the change is flushed,
 * the graph read back and asserted, and a broken rule rolls everything back as
 * 422 `TASK_WORKFLOW_INVALID {rule}`. No sequence of calls leaves a workflow
 * without exactly one open initial status, a `done` status and a `cancelled`
 * status.
 *
 * **Removing a status in use moves its Tasks** (FR-016) instead of refusing as
 * CRM does: the operator names a replacement the removed status may move to;
 * at most {@link TASK_STATUS_REASSIGN_MAX} Tasks move in the one Command,
 * each with a `tasks.task.status_change` audit row of its own carrying
 * `reason: 'status_removed'`, written on the Command's transaction so they
 * commit or roll back with it. The Tasks are counted and moved across the
 * whole platform, whoever may see them: a status is configuration, and a
 * Task the operator cannot see is still in it.
 *
 * A move is not announced per Task (`tasks.task.status_changed.v1`): one
 * Command emits at most one event, and nothing subscribes to the moves today.
 */
export class TaskWorkflowConfigService {
  constructor(private readonly deps: TaskWorkflowConfigServiceDeps) {}

  async #configure(
    command: { action: string; objectType: string; objectId: string },
    write: (em: EntityManager) => Promise<{ before: Record<string, unknown> | null; after: Record<string, unknown> | null }>,
  ): Promise<void> {
    await this.deps.commandBus.run({
      ...command,
      run: async ({ em: commandEm }) => {
        const em = commandEm as EntityManager;
        const { before, after } = await write(em);
        await em.flush();
        await this.#assertValid(em);
        return { result: undefined, before, after };
      },
    });
  }

  async #assertValid(em: EntityManager): Promise<void> {
    const graph = await this.deps.workflow.graph(em);
    try {
      graph.assertValid();
    } catch (error) {
      if (error instanceof TaskWorkflowConfigError) throw workflowInvalid(error.rule, error.message);
      throw error;
    }
  }

  /** How many Tasks hold `code`, platform-wide — a status is configuration, whoever asks. */
  async #inUseCount(em: EntityManager, code: string): Promise<number> {
    const rows = (await em.execute(`select count(*)::int as "n" from "tasks" where "status" = ?`, [code])) as Array<{
      n: number;
    }>;
    return Number(rows[0]?.n ?? 0);
  }

  /** The status row, locked for this Command: a move into it holds it shared until it commits. */
  async #locked(em: EntityManager, code: string): Promise<TaskStatus> {
    const status = await em.findOne(TaskStatus, { code }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    if (!status) throw statusNotFound(code);
    return status;
  }

  /**
   * Move the initial flag onto `target`. Two flushes: the partial unique index
   * allows one initial row at any instant, so the old flag is cleared first.
   */
  async #moveInitialFlag(em: EntityManager, target: TaskStatus): Promise<string | null> {
    const current = await em.findOne(TaskStatus, { isInitial: true });
    if (current && current.id !== target.id) {
      current.isInitial = false;
      await em.flush();
    }
    target.isInitial = true;
    return current && current.id !== target.id ? current.code : null;
  }

  /** `POST /tasks/statuses`. */
  async createStatus(input: CreateTaskStatusBody): Promise<void> {
    await this.#configure({ action: 'tasks.status.create', objectType: 'task_status', objectId: input.code }, async (em) => {
      if (await em.findOne(TaskStatus, { code: input.code })) {
        throw workflowInvalid('status_code_taken', `A status with the code "${input.code}" already exists.`);
      }
      if (input.isInitial && input.category !== 'open') {
        throw workflowInvalid('initial_must_be_open', `The initial status "${input.code}" must be an open status.`);
      }
      const status = em.create(TaskStatus, {
        code: input.code,
        name: { ...input.name },
        defaultName: input.name.en,
        category: input.category,
        isInitial: false,
        weight: input.weight,
        color: input.color,
      });
      let previousInitial: string | null = null;
      if (input.isInitial) {
        await em.flush();
        previousInitial = await this.#moveInitialFlag(em, status);
      }
      return { before: previousInitial ? { initialStatusCode: previousInitial } : null, after: snapshot(status) };
    });
  }

  /**
   * `PATCH /tasks/statuses/:code` — names, colour, position, category, initial.
   * The initial status is not unmarked: another one is marked instead, or the
   * workflow answers `exactly_one_initial`. The category changes only while no
   * Task is in the status (`category_in_use`).
   */
  async updateStatus(code: string, patch: UpdateTaskStatusBody): Promise<void> {
    await this.#configure({ action: 'tasks.status.update', objectType: 'task_status', objectId: code }, async (em) => {
      const status = await this.#locked(em, code);
      const before = snapshot(status);
      if (patch.name !== undefined) {
        status.name = { ...patch.name };
        status.defaultName = patch.name.en;
      }
      if (patch.color !== undefined) status.color = patch.color;
      if (patch.weight !== undefined) status.weight = patch.weight;
      if (patch.category !== undefined && patch.category !== status.category) {
        const inUse = await this.#inUseCount(em, code);
        if (inUse > 0) {
          throw workflowInvalid(
            'category_in_use',
            `Tasks are in the status "${code}", so what it means cannot change. Move them to another status first.`,
          );
        }
        status.category = patch.category;
      }
      let previousInitial: string | null = null;
      if (patch.isInitial === false && status.isInitial) status.isInitial = false;
      if (patch.isInitial === true && !status.isInitial) {
        if (status.category !== 'open') {
          throw workflowInvalid('initial_must_be_open', `The initial status "${code}" must be an open status.`);
        }
        await em.flush();
        previousInitial = await this.#moveInitialFlag(em, status);
      }
      return {
        before: previousInitial ? { ...before, initialStatusCode: previousInitial } : before,
        after: snapshot(status),
      };
    });
  }

  /**
   * `PUT /tasks/statuses/order` (issue #1560): the whole list in its new
   * order, one Command — one audit entry, no half-moved list. Every status row
   * is locked first, so a concurrent create, removal or reorder waits for this
   * one. The weights are rewritten {@link REORDER_WEIGHT_STEP} apart.
   */
  async reorderStatuses(input: ReorderTaskStatusesBody): Promise<void> {
    await this.#configure({ action: 'tasks.status.reorder', objectType: 'task_status', objectId: 'order' }, async (em) => {
      const statuses = await em.find(
        TaskStatus,
        {},
        { orderBy: { weight: 'asc', code: 'asc' }, lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      const before = statuses.map((status) => status.code);
      assertCompleteOrder(before, input.orderedCodes, statusNotFound);
      const byCode = new Map(statuses.map((status) => [status.code, status]));
      input.orderedCodes.forEach((code, index) => {
        const status = byCode.get(code);
        if (status) status.weight = (index + 1) * REORDER_WEIGHT_STEP;
      });
      return { before: { order: before }, after: { order: [...input.orderedCodes] } };
    });
  }

  /**
   * `DELETE /tasks/statuses/:code?replacement=` (FR-016). A status in use takes
   * a `replacement` the removed status may move to; its Tasks move there, each
   * with its own history row. Above {@link TASK_STATUS_REASSIGN_MAX} Tasks the
   * removal answers 409 `TASK_STATUS_IN_USE_TOO_MANY` and moves nothing.
   */
  async deleteStatus(code: string, replacement: string | undefined, language: SupportedLanguage): Promise<void> {
    await this.#configure({ action: 'tasks.status.delete', objectType: 'task_status', objectId: code }, async (em) => {
      const status = await this.#locked(em, code);
      // Locked: a Task cannot leave or enter the status until this commits.
      const held = await holdTasksFor(em, 'status', code, {
        message: `More than ${TASK_STATUS_REASSIGN_MAX} Tasks are in the status "${code}". Move some of them first.`,
        details: { statusCode: code },
      });

      let moved = 0;
      if (held.length > 0) {
        if (replacement === undefined || replacement === code) {
          throw workflowInvalid(
            'replacement_required',
            `Tasks are in the status "${code}": name the status they move to.`,
          );
        }
        const graph = await this.deps.workflow.graph(em);
        const target = graph.get(replacement);
        if (!target) throw taskStatusUnknown(replacement);
        if (!graph.canTransition(code, replacement)) throw transitionForbidden(graph, code, language);
        // The replacement too is held until this commits: it cannot be removed under the move.
        await em.findOne(TaskStatus, { code: replacement }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        moved = await this.#reassign(em, held, code, replacement, target.category === 'done');
      }

      const transitions = await em.find(TaskStatusTransition, { $or: [{ fromCode: code }, { toCode: code }] });
      const before = {
        ...snapshot(status),
        transitions: transitions.map((edge) => `${edge.fromCode}>${edge.toCode}`).sort(),
        ...(moved > 0 ? { replacement, moved } : {}),
      };
      em.remove(transitions);
      em.remove(status);
      return { before, after: null };
    });
  }

  /**
   * Move `held` from `from` to `to` in one statement, and write one
   * `tasks.task.status_change` audit row per Task on the Command's transaction
   * — each Task's history shows the move, `reason: 'status_removed'`.
   */
  async #reassign(em: EntityManager, held: readonly HeldTask[], from: string, to: string, toDone: boolean): Promise<number> {
    const now = new Date();
    const ids = heldIds(held);
    await em.execute(
      `update "tasks" set "status" = ?, "completed_at" = ${toDone ? `coalesce("completed_at", ?)` : 'null'}, "updated_at" = ?
        where "id" = any(?::uuid[])`,
      toDone ? [to, now, now, ids] : [to, now, ids],
    );
    recordReassignments(this.deps.auditLog, em, held, 'tasks.task.status_change', (row) => {
      const completedAt = row.completed_at === null ? null : new Date(row.completed_at).toISOString();
      return {
        before: { status: from, completedAt },
        after: { status: to, completedAt: toDone ? (completedAt ?? now.toISOString()) : null, reason: 'status_removed' },
      };
    });
    return held.length;
  }

  /** `PUT /tasks/transitions` — a delta: moves added, moves removed. */
  async setTransitions(input: SetTaskTransitionsBody): Promise<void> {
    await this.#configure({ action: 'tasks.transitions.change', ...TRANSITIONS_OBJECT }, async (em) => {
      const codes = new Set((await em.find(TaskStatus, {})).map((status) => status.code));
      const existing = await em.find(TaskStatusTransition, {});
      const byKey = new Map(existing.map((edge) => [`${edge.fromCode}>${edge.toCode}`, edge]));
      const added: string[] = [];
      const removed: string[] = [];
      for (const edge of input.add ?? []) {
        if (!codes.has(edge.from) || !codes.has(edge.to)) {
          throw workflowInvalid(
            'transition_unknown_status',
            `A move names a status that is not configured: ${edge.from} → ${edge.to}.`,
          );
        }
        const key = `${edge.from}>${edge.to}`;
        if (byKey.has(key)) continue;
        byKey.set(key, em.create(TaskStatusTransition, { fromCode: edge.from, toCode: edge.to }));
        added.push(key);
      }
      for (const edge of input.remove ?? []) {
        const key = `${edge.from}>${edge.to}`;
        const row = byKey.get(key);
        if (!row) continue;
        em.remove(row);
        byKey.delete(key);
        removed.push(key);
      }
      return { before: { removed }, after: { added } };
    });
  }
}
