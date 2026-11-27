import type { EntityManager } from '@mikro-orm/postgresql';
import type { TaskContextDescriptor } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { anyRowExists } from './scheduled-work-probe.js';
import { deleteTaskCommand, ungroupTaskCommand } from './task-commands.js';
import type { TaskContextRegistry } from './task-context-registry.js';

/**
 * The maintenance pass — Tasks never stay orphaned (`specs/165-task-management/`
 * research R-19, FR-040, SC-006; issue #450).
 *
 * A context's owner deletes its record's Tasks through `taskCommandPort` only
 * while Tasks is on; a Project deleted while Tasks was off keeps its Tasks,
 * hidden for good, and a Stage deleted then keeps its Tasks in a group no
 * screen shows. This pass, the third of the `tasks-reminders` tick, at most
 * every fifteen minutes, asks each owner which of its contexts still exist:
 *
 * - the Tasks of a context that is gone are deleted, one `tasks.task.delete`
 *   Command each, as the system, `reason: 'context_gone'` — their sub-tasks
 *   become top-level as on any deletion, and `tasks.task.deleted.v1` goes out;
 * - the Tasks of a group that is gone lose it, one `tasks.task.update` each,
 *   `reason: 'context_group_gone'`.
 *
 * **Only present owners that implement `existingContexts` are asked.**
 * `registry.present()` leaves out an owner that is off, so a Project whose
 * module is off is never taken for deleted (FR-040), and an owner without the
 * method is never cleaned. The owner's answer is **regardless of who may see**
 * — which is why the pass runs only in the system scope its worker enters, and
 * the owner refuses anybody else.
 *
 * Contexts are walked by id, {@link MAINTENANCE_BATCH} distinct ids of one type
 * at a time, so a pass's memory does not grow with the table. Every write
 * re-reads its Task under the lock and leaves one that moved meanwhile.
 *
 * Reads of `tasks` here are the platform-wide sweep's own: it learns ids, never
 * hands a Task to anybody, and writes only through the Task Commands.
 */

/** Distinct context ids asked of an owner at once. */
export const MAINTENANCE_BATCH = 500;

export interface TaskMaintenanceServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  contexts: Pick<TaskContextRegistry, 'present'>;
  /** The kernel's audit port — a deleted Task's former sub-tasks each record why they lost their parent. */
  auditLog: AuditPort;
}

export interface TaskMaintenancePassSummary {
  deleted: number;
  ungrouped: number;
}

type Cleanable = TaskContextDescriptor & Required<Pick<TaskContextDescriptor, 'existingContexts'>>;

export class TaskMaintenanceService {
  constructor(private readonly deps: TaskMaintenanceServiceDeps) {}

  /** The present owners that can say which of their contexts exist. */
  #cleanable(): Cleanable[] {
    return this.deps.contexts.present().filter((d): d is Cleanable => typeof d.existingContexts === 'function');
  }

  /**
   * Whether a pass could have anything to do — yes or no, outside any scope
   * (issue #120): some Task has a context of a type an owner able to answer
   * registered. No such owner present: no question at all.
   */
  async hasWork(): Promise<boolean> {
    const types = this.#cleanable().map((d) => d.contextType);
    if (types.length === 0) return false;
    return anyRowExists(this.deps.emFactory(), [
      { from: `from "tasks" where "context_type" in (${types.map(() => '?').join(', ')})`, params: types },
    ]);
  }

  /** One pass, in the system scope. */
  async pass(): Promise<TaskMaintenancePassSummary> {
    const summary: TaskMaintenancePassSummary = { deleted: 0, ungrouped: 0 };
    for (const owner of this.#cleanable()) {
      let after: string | null = null;
      for (;;) {
        const ids = await this.#contextIds(owner.contextType, after);
        if (ids.length === 0) break;
        after = ids[ids.length - 1]!;
        const existing = await owner.existingContexts(ids);
        const gone = ids.filter((id) => !existing.has(id));
        summary.deleted += await this.#deleteIn(owner.contextType, gone);
        summary.ungrouped += await this.#ungroupIn(
          owner.contextType,
          ids.filter((id) => existing.has(id)),
          existing,
        );
        if (ids.length < MAINTENANCE_BATCH) break;
      }
    }
    return summary;
  }

  /** The next batch of distinct context ids of `contextType`, in id order, after `after`. */
  async #contextIds(contextType: string, after: string | null): Promise<string[]> {
    const rows = (await this.deps.emFactory().execute(
      `select distinct "context_id" from "tasks"
        where "context_type" = ? and "context_id" is not null${after === null ? '' : ' and "context_id" > ?'}
        order by "context_id" limit ?`,
      after === null ? [contextType, MAINTENANCE_BATCH] : [contextType, after, MAINTENANCE_BATCH],
    )) as Array<{ context_id: string }>;
    return rows.map((row) => row.context_id);
  }

  /** Delete every Task of the gone contexts, each by its own Command. */
  async #deleteIn(contextType: string, gone: readonly string[]): Promise<number> {
    if (gone.length === 0) return 0;
    const doomed = (await this.deps.emFactory().execute(
      `select "id", "context_id" from "tasks"
        where "context_type" = ? and "context_id" = any(?::uuid[]) order by "created_at", "id"`,
      [contextType, `{${gone.join(',')}}`],
    )) as Array<{ id: string; context_id: string }>;
    let deleted = 0;
    for (const task of doomed) {
      const result = await this.deps.commandBus.run(
        deleteTaskCommand(task.id, this.deps.auditLog, {
          reason: 'context_gone',
          onlyIn: { contextType, contextId: task.context_id },
        }),
      );
      if (result.deleted) deleted += 1;
    }
    return deleted;
  }

  /** Take the gone groups off the Tasks of the contexts that exist. */
  async #ungroupIn(
    contextType: string,
    kept: readonly string[],
    existing: ReadonlyMap<string, ReadonlySet<string>>,
  ): Promise<number> {
    if (kept.length === 0) return 0;
    const grouped = (await this.deps.emFactory().execute(
      `select "id", "context_id", "context_group_id" from "tasks"
        where "context_type" = ? and "context_id" = any(?::uuid[]) and "context_group_id" is not null
        order by "id"`,
      [contextType, `{${kept.join(',')}}`],
    )) as Array<{ id: string; context_id: string; context_group_id: string }>;
    let ungrouped = 0;
    for (const task of grouped) {
      if (existing.get(task.context_id)?.has(task.context_group_id)) continue;
      const changed = await this.deps.commandBus.run(
        ungroupTaskCommand(task.id, { contextType, contextId: task.context_id, contextGroupId: task.context_group_id }),
      );
      if (changed) ungrouped += 1;
    }
    return ungrouped;
  }
}
