import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, TASK_HIERARCHY_DEPTH_MAX } from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { withCallerOptions, type CallerOptions } from '../commands/caller-options.js';
import { parentChangeRefusal } from '../domain/hierarchy.js';
import { Task } from '../entities/task.entity.js';
import type { TaskAccess, TaskRow } from './task-access.js';
import { taskNotFound } from './task-errors.js';
import { TASK_AUDIT_OBJECT_TYPE } from './task-history-service.js';

/**
 * The sub-task hierarchy (`specs/165-task-management/` User Story 5, FR-027,
 * FR-029, research R-15).
 *
 * **One lock for every change of the hierarchy.** A parent change, a Task
 * created under a parent and a Task deleted with sub-tasks each take
 * `pg_advisory_xact_lock(hashtext('tasks.hierarchy'))` inside their Command's
 * transaction before reading anything, then read the chain and the sub-tree
 * they decide on. Two changes that would only together form a cycle — `a`
 * under `b` and `b` under `a` — therefore run one after the other, and the
 * second reads what the first committed and is refused. Parent changes are
 * rare, so one platform-wide lock is cheaper to reason about than row locks on
 * two branches.
 *
 * **The rules are about the structure, not the reader** (`domain/hierarchy.ts`):
 * the chain and the sub-tree are read over every Task, whoever may see it, by
 * ids the caller obtained through `TaskAccess` — the Task being moved and the
 * parent it asked for — so a hidden descendant still closes a cycle. What the
 * reader is told is the refusal, never a Task.
 *
 * **Who may change it.** The Task that moves is the caller's to change
 * (`assertMayChange`); so is the parent it goes under — hanging a Task under
 * somebody else's private Task changes what that Task shows. A parent the
 * caller may not see is 404 `TASK_NOT_FOUND`, as one that does not exist.
 */

/** Serialises every change of the sub-task hierarchy (R-15). */
export async function lockHierarchy(em: EntityManager): Promise<void> {
  await em.execute(`select pg_advisory_xact_lock(hashtext('tasks.hierarchy'))`);
}

function refused(reason: 'cycle' | 'too_deep'): HttpError {
  return reason === 'cycle'
    ? new HttpError(
        422,
        ERROR_CODES.TASK_PARENT_CYCLE,
        'A task cannot be a sub-task of itself or of one of its own sub-tasks.',
      )
    : new HttpError(
        422,
        ERROR_CODES.TASK_HIERARCHY_TOO_DEEP,
        `Sub-tasks can be nested at most ${TASK_HIERARCHY_DEPTH_MAX} levels deep.`,
        { maxDepth: TASK_HIERARCHY_DEPTH_MAX },
      );
}

/**
 * Refuse `taskId` (or a Task being created, `null`) as a sub-task of
 * `parentId` when that would close a cycle or nest too deep. Run inside a
 * Command, **after** {@link lockHierarchy}. A parent deleted meanwhile is
 * 404 `TASK_NOT_FOUND`.
 */
export async function assertParentFits(em: EntityManager, taskId: string | null, parentId: string): Promise<void> {
  // The parent and its ancestors, the parent first. Bounded, so a chain that
  // is already too deep — or a cycle no write could have made — still ends.
  const chain = (await em.execute(
    `with recursive "chain"("id", "parent_task_id", "level") as (
       select t."id", t."parent_task_id", 1 from "tasks" t where t."id" = ?
       union all
       select p."id", p."parent_task_id", c."level" + 1
         from "tasks" p join "chain" c on p."id" = c."parent_task_id"
        where c."level" <= ?
     )
     select "id" from "chain" order by "level" asc`,
    [parentId, TASK_HIERARCHY_DEPTH_MAX],
  )) as Array<{ id: string }>;
  if (chain.length === 0) throw taskNotFound();

  let subtreeHeight = 1;
  if (taskId !== null) {
    const [row] = (await em.execute(
      `with recursive "tree"("id", "level") as (
         select t."id", 1 from "tasks" t where t."id" = ?
         union all
         select c."id", tr."level" + 1
           from "tasks" c join "tree" tr on c."parent_task_id" = tr."id"
          where tr."level" <= ?
       )
       select max("level")::int as "height" from "tree"`,
      [taskId, TASK_HIERARCHY_DEPTH_MAX],
    )) as Array<{ height: number | null }>;
    subtreeHeight = Number(row?.height ?? 1);
  }

  const refusal = parentChangeRefusal(
    taskId,
    parentId,
    { parentChain: chain.map((link) => link.id), subtreeHeight },
  );
  if (refusal) throw refused(refusal);
}

/**
 * `tasks.task.parent_change` — `parentTaskId` set or cleared, under the
 * hierarchy lock. `false` when the Task already has that parent (nothing
 * written, nothing audited). The audit state names the parent by id only:
 * the trail is not tenant-scoped, and a reader of this Task's history need
 * not be one who may see the parent.
 */
export function changeTaskParentCommand(id: string, parentId: string | null): Command<boolean> {
  return {
    action: 'tasks.task.parent_change',
    objectType: TASK_AUDIT_OBJECT_TYPE,
    objectId: id,
    run: async ({ em }) => {
      const tx = em as EntityManager;
      await lockHierarchy(tx);
      const task = await tx.findOne(Task, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!task) throw taskNotFound();
      const current = task.parentTaskId ?? null;
      if (current === parentId) return { result: false, skipAudit: true };
      if (parentId !== null) await assertParentFits(tx, id, parentId);
      task.parentTaskId = parentId;
      return { result: true, before: { parentTaskId: current }, after: { parentTaskId: parentId } };
    },
  };
}

export interface TaskHierarchyServiceDeps {
  commandBus: CommandBus;
  access: Pick<TaskAccess, 'loadVisible' | 'assertMayChange'>;
}

export class TaskHierarchyService {
  constructor(private readonly deps: TaskHierarchyServiceDeps) {}

  /**
   * A parent the caller may hang a Task under: one they may see (404
   * otherwise) and change (403 `TASK_PRIVATE_READ_ONLY` for somebody else's
   * private Task). The structure is checked by the writing Command.
   */
  async assertMayAdopt(parentId: string): Promise<void> {
    const parent = await this.deps.access.loadVisible(parentId);
    this.deps.access.assertMayChange(parent);
  }

  /**
   * Make `row` — a Task the caller loaded through `TaskAccess` and may change
   * — a sub-task of `parentId`, or top-level with `null`. `false` when nothing
   * changed.
   */
  async setParent(row: TaskRow, parentId: string | null, caller: CallerOptions = {}): Promise<boolean> {
    if ((row.parent_task_id ?? null) === parentId) return false;
    if (parentId !== null && parentId !== row.id) await this.assertMayAdopt(parentId);
    return this.deps.commandBus.run(withCallerOptions(changeTaskParentCommand(row.id, parentId), caller));
  }
}
