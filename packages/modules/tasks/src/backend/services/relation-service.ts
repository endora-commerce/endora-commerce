import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { recordAuditFromContext, type CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withCallerOptions, type CallerOptions } from '../commands/caller-options.js';
import { requireActingAdmin, type TaskAccess } from './task-access.js';
import { TASK_AUDIT_OBJECT_TYPE } from './task-history-service.js';

/**
 * Related Tasks (`specs/165-task-management/` User Story 5, FR-030, research
 * R-15): two Tasks linked with no parent/child meaning, stored once in
 * `task_relations` with the smaller id first (a database check holds it) and
 * shown on both.
 *
 * - **Both Tasks are the caller's to change** (admin-api §2 "W on both
 *   Tasks"): each is loaded through `TaskAccess` — one the caller may not see
 *   is 404 `TASK_NOT_FOUND`, as one that does not exist — and asked
 *   `assertMayChange`.
 * - **Idempotent.** Relating two related Tasks, or unrelating two unrelated
 *   ones, writes nothing and records nothing; the answer is the same.
 * - **Recorded on both sides.** The Command's own audit row is the Task the
 *   route names; a second row, on the same transaction through the kernel's
 *   audit port, is the other Task's — each history shows the link come and go.
 *
 * The rows are written and deleted by the two ids `TaskAccess` handed out; the
 * related Tasks a reader is shown are read by `TaskService` under the
 * visibility pre-filter.
 */

export interface TaskRelationServiceDeps {
  commandBus: CommandBus;
  access: Pick<TaskAccess, 'loadVisible' | 'assertMayChange'>;
  /** The kernel's audit port — the other Task's row, on the Command's transaction. */
  auditLog: AuditPort;
}

function pair(one: string, other: string): [string, string] {
  return one < other ? [one, other] : [other, one];
}

export class TaskRelationService {
  constructor(private readonly deps: TaskRelationServiceDeps) {}

  /**
   * `PUT /tasks/:id/relations/:otherId`, and `taskCommandPort.relate`. `true`
   * when the link is new. `created_by_admin_user_id` is not null: a link is
   * made by somebody, so with nobody behind the call it is 403 before anything
   * is read (`specs/186-aggregate-ports/` R-23.2).
   */
  async relate(taskId: string, otherId: string, caller: CallerOptions = {}): Promise<boolean> {
    requireActingAdmin('Two Tasks are related by an administrator.');
    const [task, other] = await this.#both(taskId, otherId);
    const [a, b] = pair(task, other);
    return this.deps.commandBus.run(withCallerOptions({
      action: 'tasks.task.relate',
      objectType: TASK_AUDIT_OBJECT_TYPE,
      objectId: task,
      run: async ({ em, actor }) => {
        if (actor.actorAdminUserId === null) {
          // Unreachable past the check above, and kept: the column is not null.
          throw new Error('tasks: two Tasks are related by an administrator; the ambient actor is none.');
        }
        const tx = em as EntityManager;
        const inserted = (await tx.execute(
          `insert into "task_relations" ("task_a_id", "task_b_id", "created_by_admin_user_id", "created_at")
             values (?, ?, ?, now())
           on conflict do nothing returning "task_a_id"`,
          [a, b, actor.actorAdminUserId],
        )) as unknown[];
        if (inserted.length === 0) return { result: false, skipAudit: true };
        this.#recordOther(tx, 'tasks.task.relate', other, task, true);
        return { result: true, before: { relatedTaskId: null }, after: { relatedTaskId: other } };
      },
    }, caller));
  }

  /** `DELETE /tasks/:id/relations/:otherId`, and `taskCommandPort.unrelate`. `true` when a link was removed. */
  async unrelate(taskId: string, otherId: string, caller: CallerOptions = {}): Promise<boolean> {
    const [task, other] = await this.#both(taskId, otherId);
    const [a, b] = pair(task, other);
    return this.deps.commandBus.run(withCallerOptions({
      action: 'tasks.task.unrelate',
      objectType: TASK_AUDIT_OBJECT_TYPE,
      objectId: task,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        const deleted = (await tx.execute(
          `delete from "task_relations" where "task_a_id" = ? and "task_b_id" = ? returning "task_a_id"`,
          [a, b],
        )) as unknown[];
        if (deleted.length === 0) return { result: false, skipAudit: true };
        this.#recordOther(tx, 'tasks.task.unrelate', other, task, false);
        return { result: true, before: { relatedTaskId: other }, after: { relatedTaskId: null } };
      },
    }, caller));
  }

  /** Both Tasks, visible and changeable by the caller — their ids. */
  async #both(taskId: string, otherId: string): Promise<[string, string]> {
    if (taskId === otherId) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'A task cannot be related to itself.');
    }
    const task = await this.deps.access.loadVisible(taskId);
    const other = await this.deps.access.loadVisible(otherId);
    this.deps.access.assertMayChange(task);
    this.deps.access.assertMayChange(other);
    return [task.id, other.id];
  }

  /** The other Task's own history entry, on the Command's transaction. */
  #recordOther(em: EntityManager, action: string, objectId: string, relatedTaskId: string, related: boolean): void {
    recordAuditFromContext(this.deps.auditLog, em, {
      action,
      objectType: TASK_AUDIT_OBJECT_TYPE,
      objectId,
      stateBefore: { relatedTaskId: related ? null : relatedTaskId },
      stateAfter: { relatedTaskId: related ? relatedTaskId : null },
    });
  }
}
