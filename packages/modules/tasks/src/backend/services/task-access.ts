import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { assertMayDelete as assertContextLetsDelete } from './task-checks.js';
import type { TaskContextRegistry } from './task-context-registry.js';
import { taskNotFound } from './task-errors.js';
import type { TaskVisibility, TaskVisibilityFacts } from './task-visibility.js';

/**
 * `TaskAccess` — how a route or a service obtains **one** Task, and what the
 * caller may do with it (`specs/165-task-management/` research R-3, R-21).
 *
 * Every read of a Task by id is `findVisible` / `loadVisible`: the row, asked
 * of {@link TaskVisibility} (context, draft, private) before it is handed out,
 * so a Task the caller may not see answers 404 `TASK_NOT_FOUND` exactly as a
 * missing one does. Every write starts from `loadVisible` and asks
 * `assertMayChange` — or `assertMayDelete` for a delete.
 *
 * **The seam.** Every Task-owned table is `@RuleScoped` and no ORM filter backs
 * that class, so the guard against a forgotten read path is
 * `visibility-seam.test.ts`: it fails on any read of a rule-scoped table
 * outside `task-visibility.ts`, this file and the files of
 * {@link TASK_ACCESS_READERS}, each with why that read is safe.
 */

/**
 * Files besides this one that read a rule-scoped Task table, each with why
 * that is safe. A file belongs here only when **every** such read either
 * composes {@link TaskVisibility.condition} / `taskVisibilitySql`, or is keyed
 * by Task ids this file or such a read handed out. Paths are relative to
 * `src/backend/`.
 */
export const TASK_ACCESS_READERS: Readonly<Record<string, string>> = {
  'services/task-service.ts':
    'The list, My Tasks, the board, search, the read port and global search compose the visibility pre-filter ' +
    '(`TaskVisibility.condition` / `taskVisibilitySql`); a sub-task count composes it over the children too. ' +
    'Assignees, tags, sub-task rows and related-Task pairs are read only for the ids those queries returned (the ' +
    'other side of a pair through the pre-filter again); a Task just written is ' +
    're-read by the id its Command wrote.',
  'services/task-commands.ts':
    'Every Command runs after its caller loaded the Task through `TaskAccess.loadVisible` (or, for the write ' +
    'port, is the context owner acting on its own record): it locks that one id and reads its assignees by it, ' +
    'and a delete reads the ids of its sub-tasks — every one, whoever may see it — to record on each that it ' +
    'lost its parent; the caller counts only those its reader may see.',
  'services/attachment-service.ts':
    'Every read starts from `loadVisible` and is keyed by that Task\'s id, or — to ask which Tasks already hold ' +
    'a file — reads only Task ids by asset and answers them through `visibleIds`, so a file attached to a Task ' +
    'the caller may not see is refused without saying where it is.',
  'services/comment-service.ts':
    'Every read and write starts from `loadVisible` and is keyed by that Task\'s id: the thread, the comment an ' +
    'author changes (and its `task_references` rows, replaced by the saving Command), and the assignees a new ' +
    'comment tells — each of whom is asked again whether they may see the Task before being told.',
  'services/priority-service.ts':
    'The in-use count the list shows composes the visibility pre-filter (`TaskVisibility.condition`). Removing a ' +
    'priority is configuration (FR-024, research R-9): it moves **every** Task holding it to the replacement, or ' +
    'clears it, whoever may see the Task — drafts and private Tasks included — by the ids `task-reassignment.ts` ' +
    'locked, hands nothing back but the list, and records each move in that Task\'s own history.',
  'services/tag-service.ts':
    'The usage count the list shows joins `tasks` and composes the visibility pre-filter (`TaskVisibility.condition`). ' +
    'Deleting a tag counts its assignments platform-wide, whoever may see the Tasks, because the tag leaves every one ' +
    'of them (research R-10): the count goes into the tag\'s own audit row, never to the caller.',
  'services/task-reassignment.ts':
    'A status or priority removal (FR-016, FR-024) locks the ids and completion times of **every** Task holding the ' +
    'value, whoever may see it — a Task the operator cannot see still holds it — inside the removing Command; the ' +
    'caller moves them and records each move in that Task\'s history, and answers only how many moved.',
  'services/task-asset-references.ts':
    'The asset library asks whether **anything** still uses a file before deleting it — platform-wide on ' +
    'purpose, by whoever deletes it, who need not see the Task — and is answered with the Task\'s number, never ' +
    'its title (research R-7; Projects\' `project-asset-references.ts`). Its reader restriction ' +
    '(`specs/166-asset-reference-visibility/` FR-002) adds the attached files of the Tasks the caller may **not** ' +
    'see — the NULL-safe complement of `TaskVisibility.condition`, `(…) is not true` — and every attached file, ' +
    'read while Tasks is off; which Tasks the caller sees is `TaskAccess.visibleIds`.',
  'services/hierarchy-service.ts':
    'A parent change reads the proposed parent\'s chain of ancestors and the moved Task\'s sub-tree over every ' +
    'Task, whoever may see it — a hidden descendant still closes a cycle (FR-027, R-15) — starting from the two ' +
    'ids the caller obtained through `loadVisible`, under the hierarchy lock; it hands back a refusal, never a Task.',
  'services/record-link-service.ts':
    'Reads, writes and deletes the `task_record_links` rows of one Task the caller loaded through `loadVisible` ' +
    '(and, to write, may change), keyed by that id; the Tasks of one record are listed by `task-service.ts` under ' +
    'the visibility pre-filter. A link narrows and widens nobody\'s view of the Task (Q2 = A).',
  'services/relation-service.ts':
    'Writes and deletes the one `task_relations` row of two Tasks the caller loaded through `loadVisible` and may ' +
    'change; the related Tasks a reader is shown are read by `task-service.ts` under the visibility pre-filter.',
  'services/workflow-config-service.ts':
    'A status is platform configuration: changing what it means, or removing it, asks how many Tasks are in it ' +
    'and moves them to the replacement **whoever may see them**, because a Task the operator cannot see is ' +
    'still in the status (FR-016, research R-1). It moves the ids `task-reassignment.ts` locked, hands nothing ' +
    'back to the caller but the workflow, and records each move in that Task\'s own audit history.',
  'services/reminder-service.ts':
    'Setting and removing reminders starts from `loadVisible` and reads the reminders and assignees of that one ' +
    'Task by its id. The delivery pass is a sweep in the system scope (research R-17): it reads the due ' +
    '(reminder, recipient) pairs with their Task\'s number, title and visibility facts, platform-wide on purpose, ' +
    'and asks the audience question — `tasks:read`, the draft/private rule, the context\'s `canSeeAs` — for each ' +
    'recipient before anything is sent; a Task a recipient may not see is recorded `skipped`, never shown.',
  'services/reminder-schedule.ts':
    'Moves or removes the relative reminders of one Task inside the Command that changed its due moment, keyed by ' +
    'the id that Command locked after its caller loaded the Task through `loadVisible`.',
  'services/digest-service.ts':
    'The daily digest pass, in the system scope (research R-18): for each claimed subscriber it reads the open ' +
    'Tasks assigned to them, due today or before, and asks the audience question — `tasks:read`, the ' +
    'draft/private rule, the context\'s `canSeeAs` — of each before it is listed.',
  'services/maintenance-service.ts':
    'The #450 clean-up, run in the system scope its worker enters (its probe answers one bit, outside any scope): it ' +
    'walks the distinct context ids of each context type whose present owner can say which still exist, and reads ' +
    'the ids of the Tasks of the contexts the owner says are gone, or whose group is — handing each to the delete or ' +
    'ungroup Command, which re-reads it under the lock. Nothing read is shown or sent to anybody.',
  'services/task-write-port.ts':
    '`deleteInContext` lists the ids of one context for its owner — the module that registered the context type ' +
    'and is deleting its own record — and hands each to the delete Command. `createMany` looks up which of the ' +
    'source keys it was handed that one context already holds, for the same owner, and answers their ids in their ' +
    'place: ids of Tasks that owner created in its own record (R-19).',
};

/** One `tasks` row as every read selects it. */
export interface TaskRow {
  id: string;
  number: string;
  title: string;
  description: string;
  status: string;
  /** `YYYY-MM-DD`, formatted by the query so no driver date parsing is involved. */
  due_on: string | null;
  due_at: Date | string | null;
  start_on: string | null;
  priority_code: string | null;
  is_draft: boolean;
  is_private: boolean;
  parent_task_id: string | null;
  source_key: string | null;
  custom_field_values: Record<string, unknown> | null;
  published_at: Date | string | null;
  completed_at: Date | string | null;
  created_by_admin_user_id: string;
  context_type: string | null;
  context_id: string | null;
  context_group_id: string | null;
  context_note: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** The columns of {@link TaskRow}, over `tasks` aliased `t`. */
export const TASK_COLUMNS = `t."id", t."number", t."title", t."description", t."status",
  to_char(t."due_on", 'YYYY-MM-DD') as "due_on", t."due_at", to_char(t."start_on", 'YYYY-MM-DD') as "start_on",
  t."priority_code", t."is_draft", t."is_private", t."parent_task_id", t."source_key", t."custom_field_values",
  t."published_at", t."completed_at", t."created_by_admin_user_id",
  t."context_type", t."context_id", t."context_group_id", t."context_note", t."created_at", t."updated_at"`;

export function isUuid(value: string): boolean {
  return isUuidShape(value);
}

/** What {@link TaskVisibility.canSee} is asked about one row. */
export function visibilityFacts(row: TaskRow): TaskVisibilityFacts {
  return {
    contextType: row.context_type,
    contextId: row.context_id,
    createdByAdminUserId: row.created_by_admin_user_id,
    draft: row.is_draft,
    private: row.is_private,
  };
}

/** The administrator behind the current request, or `null` for the system. */
export function actingAdminUserId(): string | null {
  const actor = getTenantContext()?.actor;
  return actor?.kind === 'admin' && actor.id ? actor.id : null;
}

/** Someone else's private Task: readable and deletable by a `tasks:see_private` holder, nothing else. */
export function isSomeoneElsesPrivate(row: Pick<TaskRow, 'is_private' | 'created_by_admin_user_id'>): boolean {
  return row.is_private && row.created_by_admin_user_id !== actingAdminUserId();
}

export interface TaskAccessDeps {
  emFactory: () => EntityManager;
  visibility: TaskVisibility;
  contexts: TaskContextRegistry;
}

export class TaskAccess {
  constructor(private readonly deps: TaskAccessDeps) {}

  /** One Task the caller may see, or `null` — hidden and missing alike. */
  async findVisible(id: string): Promise<TaskRow | null> {
    if (!isUuid(id)) return null;
    const rows = (await this.deps.emFactory().execute(`select ${TASK_COLUMNS} from "tasks" t where t."id" = ?`, [
      id,
    ])) as TaskRow[];
    const row = rows[0];
    if (!row) return null;
    return (await this.deps.visibility.canSee(visibilityFacts(row))) ? row : null;
  }

  /** The **only** way a route or a service obtains a Task: 404 `TASK_NOT_FOUND` for one hidden or missing. */
  async loadVisible(id: string): Promise<TaskRow> {
    const row = await this.findVisible(id);
    if (!row) throw taskNotFound();
    return row;
  }

  /** Which of `ids` the caller may see — the ones hidden, missing or malformed are absent. */
  async visibleIds(ids: readonly string[]): Promise<Set<string>> {
    const candidates = [...new Set(ids.filter(isUuid))];
    if (candidates.length === 0) return new Set();
    const visible = await this.deps.visibility.condition('t');
    const rows = (await this.deps.emFactory().execute(
      `select t."id" from "tasks" t where t."id" = any(?::uuid[])${visible ? ` and ${visible.sql}` : ''}`,
      [`{${candidates.join(',')}}`, ...(visible?.params ?? [])],
    )) as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
  }

  /**
   * The Task a write has just committed, read by id **without** visibility: the
   * write may have moved it into a context the caller does not see, and
   * answering 404 for a change that committed would misreport it. Never a first
   * read — its id comes from a Command that ran after `loadVisible` or created it.
   */
  async rowAfterWrite(id: string): Promise<TaskRow> {
    const rows = (await this.deps.emFactory().execute(`select ${TASK_COLUMNS} from "tasks" t where t."id" = ?`, [
      id,
    ])) as TaskRow[];
    if (!rows[0]) throw taskNotFound();
    return rows[0];
  }

  /**
   * Any write but a delete: someone else's private Task — which only a holder
   * of `tasks:see_private` sees at all — answers 403 `TASK_PRIVATE_READ_ONLY`.
   * A context's own say (`canChangeTasks`) is asked where 163 asked it: when a
   * Task goes into or out of a record (`task-checks.ts`).
   */
  assertMayChange(row: TaskRow): void {
    if (isSomeoneElsesPrivate(row)) {
      throw new HttpError(
        403,
        ERROR_CODES.TASK_PRIVATE_READ_ONLY,
        'This private Task belongs to someone else: it may be read or deleted, not changed.',
      );
    }
  }

  /** A delete: the record owner's `canChangeTasks` for a Task in a context (163 T147). */
  async assertMayDelete(row: TaskRow): Promise<void> {
    await assertContextLetsDelete(this.deps.contexts, { contextType: row.context_type, contextId: row.context_id });
  }
}
