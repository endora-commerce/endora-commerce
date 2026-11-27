import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type OrderListPort,
  type OrderReadPort,
  type TaskLink,
  type TaskLinkKind,
  type TaskLinkTarget,
  type TaskLookupOption,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { OwnerReadChecks } from './owner-read-permissions.js';
import type { SwitchableRecordKind, TaskRecordOwners } from './record-owners.js';
import type { TaskReferenceService } from './reference-service.js';
import { withCallerOptions, type CallerOptions } from '../commands/caller-options.js';
import { isUuid, requireActingAdmin, type TaskAccess } from './task-access.js';
import { TASK_AUDIT_OBJECT_TYPE } from './task-history-service.js';

/** How many records the link picker offers for one search. */
export const RECORD_LOOKUP_LIMIT = 20;

/** The read check of each switchable kind a Task may be linked to. */
const SWITCHABLE_CHECK: Readonly<Record<Exclude<TaskLinkKind, 'order'>, 'quoteRequests' | 'opportunities'>> = {
  opportunity: 'opportunities',
  quote_request: 'quoteRequests',
};

export interface TaskRecordLinkServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  access: Pick<TaskAccess, 'loadVisible' | 'assertMayChange'>;
  /** The resolver a reference goes through — a link is named exactly as a reference to its record is. */
  references: Pick<TaskReferenceService, 'resolveTargets'>;
  /** `orders`' read port and list — lazy, resolved per call. `orders` cannot be switched off. */
  orders: Pick<OrderReadPort, 'findByIds'>;
  orderList: OrderListPort;
  /** The one door to Opportunities and Quote Requests — asked `isPresent` first. */
  owners: Pick<TaskRecordOwners, 'isPresent' | 'labels' | 'search'>;
  mayRead: Pick<OwnerReadChecks, 'orders' | 'quoteRequests' | 'opportunities'>;
}

/** A link as its audit states name it: the record, never its number. */
function audited(target: { kind: TaskLinkKind; id: string }): { kind: TaskLinkKind; recordId: string } {
  return { kind: target.kind, recordId: target.id };
}

function linkInvalid(): HttpError {
  return new HttpError(
    422,
    ERROR_CODES.TASK_LINK_INVALID,
    'This record cannot be linked: it does not exist, you may not read it, or its module is switched off.',
  );
}

function linkNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'This Task has no such link.');
}

interface LinkRow {
  id: string;
  record_kind: TaskLinkKind;
  record_id: string;
}

/**
 * A Task's links to the Opportunities, Orders and Quote Requests it is about
 * (`specs/165-task-management/` User Story 6, FR-031 – FR-033, research R-16),
 * kept in `task_record_links` by value.
 *
 * - **Validated when made, never after.** The record's owner is present, the
 *   caller holds that owner's read code (`crm:read`, `orders:read`,
 *   `rfqs:handle`) and the owner's port finds the record — otherwise 422
 *   `TASK_LINK_INVALID`, the three alike. Presence is decided before the port
 *   is asked; nothing is caught. Removing a link is never validated: a link of
 *   a module that is off can be removed.
 * - **No effect on who sees the Task** (owner ruling Q2 = A). A link is a
 *   reference: shown to each reader through the same resolver as a reference
 *   to the record (`TaskReferenceService.resolveTargets`), *unavailable* to a
 *   reader who may not read it, while its owner is off, or once it is gone.
 * - **Idempotent.** Linking a record already linked answers the existing link
 *   and records nothing; the same record twice in a create body is one link.
 * - **In the Task's history**: `tasks.task.link` / `tasks.task.unlink`, the
 *   record named by kind and id; a create records its links in its own entry.
 *
 * Every read of `task_record_links` here is keyed by a Task id `TaskAccess`
 * handed out; the Tasks of one record are listed by `TaskService` under the
 * visibility pre-filter.
 */
export class TaskRecordLinkService {
  constructor(private readonly deps: TaskRecordLinkServiceDeps) {}

  /**
   * The targets of a write, each one the caller may link — distinct, in the
   * order given — or 422 `TASK_LINK_INVALID` for the first that is not.
   */
  async assertLinkable(targets: readonly TaskLinkTarget[]): Promise<TaskLinkTarget[]> {
    const distinct: TaskLinkTarget[] = [];
    const seen = new Set<string>();
    for (const target of targets) {
      const key = `${target.kind}:${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      distinct.push({ kind: target.kind, id: target.id });
    }
    for (const kind of new Set(distinct.map((target) => target.kind))) {
      const ids = distinct.filter((target) => target.kind === kind).map((target) => target.id);
      const found = await this.#findable(kind, ids);
      if (ids.some((id) => !found.has(id))) throw linkInvalid();
    }
    return distinct;
  }

  /** The links of one Task the caller obtained through `TaskAccess`, each resolved for the reader. */
  async linksOf(taskId: string): Promise<TaskLink[]> {
    const rows = (await this.deps.emFactory().execute(
      `select l."id", l."record_kind", l."record_id" from "task_record_links" l
        where l."task_id" = ? order by l."record_kind", l."created_at", l."id"`,
      [taskId],
    )) as LinkRow[];
    if (rows.length === 0) return [];
    const resolved = await this.deps.references.resolveTargets(
      rows.map((row) => ({ type: row.record_kind, id: row.record_id })),
    );
    return rows.map((row, index) => {
      const reference = resolved[index];
      return {
        id: row.id,
        kind: row.record_kind,
        recordId: row.record_id,
        available: reference?.available ?? false,
        label: reference?.label ?? null,
        url: reference?.url ?? null,
      };
    });
  }

  /** `POST /tasks/:id/links` — the link, resolved for the reader, and whether it is new. */
  async link(taskId: string, target: TaskLinkTarget): Promise<{ link: TaskLink; created: boolean }> {
    const { taskId: id, created } = await this.linkRecord(taskId, target);
    const link = (await this.linksOf(id)).find((one) => one.kind === target.kind && one.recordId === target.id);
    if (!link) throw linkNotFound();
    return { link, created };
  }

  /**
   * The write of `POST /tasks/:id/links`, shared with `taskCommandPort.link`:
   * the link's id, and whether it is new — an existing link's id, with nothing
   * recorded, for a record already linked. `linked_by_admin_user_id` is not
   * null, so with nobody behind the call it is 403 before anything is read
   * (`specs/186-aggregate-ports/` R-23.2).
   */
  async linkRecord(
    taskId: string,
    target: TaskLinkTarget,
    caller: CallerOptions = {},
  ): Promise<{ taskId: string; linkId: string; created: boolean }> {
    requireActingAdmin('A record is linked to a Task by an administrator.');
    const task = await this.deps.access.loadVisible(taskId);
    this.deps.access.assertMayChange(task);
    await this.assertLinkable([target]);
    const created = await this.deps.commandBus.run(withCallerOptions({
      action: 'tasks.task.link',
      objectType: TASK_AUDIT_OBJECT_TYPE,
      objectId: task.id,
      run: async ({ em, actor }) => {
        if (actor.actorAdminUserId === null) {
          // Unreachable past the check above, and kept: the column is not null.
          throw new Error('tasks: a record is linked by an administrator; the ambient actor is none.');
        }
        const inserted = (await (em as EntityManager).execute(
          `insert into "task_record_links" ("task_id", "record_kind", "record_id", "linked_by_admin_user_id", "created_at")
             values (?, ?, ?, ?, now())
           on conflict do nothing returning "id"`,
          [task.id, target.kind, target.id, actor.actorAdminUserId],
        )) as unknown[];
        if (inserted.length === 0) return { result: false, skipAudit: true };
        return { result: true, before: { link: null }, after: { link: audited(target) } };
      },
    }, caller));
    const rows = (await this.deps.emFactory().execute(
      `select l."id" from "task_record_links" l where l."task_id" = ? and l."record_kind" = ? and l."record_id" = ?`,
      [task.id, target.kind, target.id],
    )) as Array<{ id: string }>;
    if (!rows[0]) throw linkNotFound();
    return { taskId: task.id, linkId: rows[0].id, created };
  }

  /** `DELETE /tasks/:id/links/:linkId`, and `taskCommandPort.unlink` — 404 for a link this Task does not have. */
  async unlink(taskId: string, linkId: string, caller: CallerOptions = {}): Promise<void> {
    const task = await this.deps.access.loadVisible(taskId);
    this.deps.access.assertMayChange(task);
    if (!isUuid(linkId)) throw linkNotFound();
    await this.deps.commandBus.run(withCallerOptions({
      action: 'tasks.task.unlink',
      objectType: TASK_AUDIT_OBJECT_TYPE,
      objectId: task.id,
      run: async ({ em }) => {
        const deleted = (await (em as EntityManager).execute(
          `delete from "task_record_links" where "id" = ? and "task_id" = ? returning "record_kind", "record_id"`,
          [linkId, task.id],
        )) as Array<{ record_kind: TaskLinkKind; record_id: string }>;
        const row = deleted[0];
        if (!row) throw linkNotFound();
        return {
          result: undefined,
          before: { link: audited({ kind: row.record_kind, id: row.record_id }) },
          after: { link: null },
        };
      },
    }, caller));
  }

  /**
   * `GET /tasks/lookups/records?kind=&q=` — what the link picker offers: the
   * records of one kind the caller may read, while the owner is on; nothing
   * otherwise. A Quote Request is offered by its number typed in full (its
   * port publishes no search).
   */
  async records(kind: TaskLinkKind, q: string | undefined): Promise<TaskLookupOption[]> {
    const typed = (q ?? '').trim();
    if (kind === 'order') {
      if (!(await this.deps.mayRead.orders())) return [];
      const page = await this.deps.orderList.list({
        ...(typed !== '' ? { q: typed } : {}),
        page: 1,
        pageSize: RECORD_LOOKUP_LIMIT,
      });
      return page.rows.map((row) => ({ id: row.id, label: row.businessId }));
    }
    if (!(await this.#mayReadSwitchable(kind))) return [];
    const found = await this.deps.owners.search(kind, typed, RECORD_LOOKUP_LIMIT);
    return found.map((record) => ({
      id: record.id,
      label: record.label,
      ...(record.sublabel ? { sublabel: record.sublabel } : {}),
    }));
  }

  /** Which of `ids` of one kind the caller may link: present owner, read code, found by the port. */
  async #findable(kind: TaskLinkKind, ids: readonly string[]): Promise<Set<string>> {
    if (kind === 'order') {
      if (!(await this.deps.mayRead.orders())) return new Set();
      return new Set((await this.deps.orders.findByIds([...ids])).map((order) => order.id));
    }
    if (!(await this.#mayReadSwitchable(kind))) return new Set();
    return new Set((await this.deps.owners.labels(kind, ids)).keys());
  }

  /** Presence first, then the reader's code — never the port of an absent owner. */
  async #mayReadSwitchable(kind: SwitchableRecordKind & TaskLinkKind): Promise<boolean> {
    if (!this.deps.owners.isPresent(kind)) return false;
    return this.deps.mayRead[SWITCHABLE_CHECK[kind]]();
  }
}
