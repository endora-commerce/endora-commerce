import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  foldDiacritics,
  TASK_MINE_MAX,
  mentionedAdminUserIds,
  type AdminUserReadPort,
  type AdminUserRecord,
  type CreateTaskBody,
  type CustomFieldListFilterField,
  type CustomFieldListFilterPort,
  type CustomFieldValuePort,
  type MyTasksQuery,
  type PermissionReadPort,
  type SupportedLanguage,
  type TaskAssigneeOption,
  type TaskBoardCardField,
  type TaskBoardQuery,
  type TaskDeleteResult,
  type TaskContextDescription,
  type TaskContextQuery,
  type TaskContextSummary,
  type TaskDetail,
  type TaskListQuery,
  type TaskListResponse,
  type TaskReminder,
  type TaskRecord,
  type TaskStatusChangeBody,
  type TaskStatusChangeResult,
  type TaskSummary,
  type TaskTagRef,
  type TaskWorkflow,
  type UpdateTaskBody,
} from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { TaskAdminSearchQuery, TaskAdminSearchRow } from '../admin-search-provider.js';
import { cardFieldValues } from '../domain/board-card-fields.js';
import { dueOnFor, isOverdue } from '../domain/due-moment.js';
import {
  decodeListCursor,
  defaultDirection,
  encodeListCursor,
  keysetAfter,
  listOrdering,
} from '../domain/list-cursor.js';
import type { TaskStatusGraph } from '../domain/task-status-graph.js';
import type { TaskPriority } from '../entities/task-priority.entity.js';
import {
  actingAdminUserId,
  isSomeoneElsesPrivate,
  isUuid,
  TASK_COLUMNS,
  type TaskAccess,
  type TaskRow,
} from './task-access.js';
import type { TaskHierarchyService } from './hierarchy-service.js';
import type { TaskAudience, TaskAudienceFacts, TaskMentionService } from './mention-service.js';
import type { TaskPriorityService } from './priority-service.js';
import type { TaskRecordLinkService } from './record-link-service.js';
import type { TaskReferenceService } from './reference-service.js';
import type { TaskTagService } from './tag-service.js';
import {
  assertAssigneesSeeContext,
  assertContextForCaller,
  assertMayBeAssigned,
  assertMayPutIn,
  assertMayTakeOut,
} from './task-checks.js';
import {
  changeTaskAssigneesCommand,
  changeTaskCustomFieldsCommand,
  changeTaskPriorityCommand,
  changeTaskPrivacyCommand,
  changeTaskTagsCommand,
  createTaskCommand,
  deleteTaskCommand,
  publishTaskCommand,
  updateTaskCommand,
  type AssigneeChange,
  type TaskFieldChanges,
} from './task-commands.js';
import { mergeTaskCustomFields } from './task-custom-fields.js';
import type { TaskContextRegistry } from './task-context-registry.js';
import {
  mapDraftPrivateViolation,
  taskAlreadyPublished,
  taskContextInvalid,
  taskNotFound,
  taskPrivateAssignee,
  taskPrivateInContext,
} from './task-errors.js';
import { tellAfterCommit, type TaskNotifier } from './task-notifier.js';
import type { TaskTransitionService } from './task-transition-service.js';
import { taskVisibilitySql, type SqlFragment, type TaskVisibility, type TaskVisibilityScope } from './task-visibility.js';
import { priorityRef, statusRef, type TaskWorkflowRead } from './task-workflow-read.js';

export { taskNotFound } from './task-errors.js';
export { actingAdminUserId } from './task-access.js';
export type { TaskRow } from './task-access.js';

/**
 * Tasks — the HTTP side of `specs/165-task-management/contracts/admin-api.md`
 * §1 (grown from 163's): the list on any sort with every filter, *My Tasks*,
 * one Task, creating, editing, moving and deleting one, and the reads the read
 * port and global search answer with.
 *
 * Every write is one or more Commands of `task-commands.ts` (Constitution
 * XIII), every refusal checked before the first runs. A `PATCH` that changes
 * several kinds of thing runs one Command per kind — fields, assignees — so
 * each has the audit row and the event the contract names. A status move is
 * its own route, checked against the configured workflow (research R-1).
 *
 * **Every read of the `tasks` table here composes the visibility pre-filter**
 * (`TaskVisibility`: context, draft, private), and a Task read by id comes
 * from `TaskAccess`. The child tables — assignees, tags, sub-tasks — are read
 * only for ids those reads returned. `visibility-seam.test.ts` holds this.
 */

/** The most options the assignee picker offers for one search. */
export const ASSIGNEE_OPTIONS_LIMIT = 50;

export interface TaskServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  visibility: TaskVisibility;
  access: TaskAccess;
  workflow: TaskWorkflowRead;
  contexts: TaskContextRegistry;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
  /** `admin_roles`' permission read port — lazy: whether a recipient may read Tasks at all (F-14). */
  permissions: PermissionReadPort;
  notifier: TaskNotifier;
  /** Whether another administrator may see a Task — who is told of an assignment (`mention-service.ts`). */
  audience: TaskAudience;
  /** The priority list and the tag list — validated against before a write (R-9, R-10). */
  priorities: Pick<TaskPriorityService, 'assertKnown'>;
  tags: Pick<TaskTagService, 'assertKnown'>;
  /** `custom_fields`' value service and list-filter port — lazy, resolved per call (R-8). */
  customFields: CustomFieldValuePort;
  customFieldListFilter: CustomFieldListFilterPort;
  /** References in the description, resolved per reader (R-5). */
  references: Pick<TaskReferenceService, 'resolve'>;
  /** Who a description newly mentions is told, after the commit (FR-006). */
  mentions: Pick<TaskMentionService, 'tell'>;
  /** The one door a status change goes through (research R-1, `task-transition-service.ts`). */
  transitions: Pick<TaskTransitionService, 'apply'>;
  /** The sub-task hierarchy: who may be a parent, and the parent change (research R-15). */
  hierarchy: Pick<TaskHierarchyService, 'assertMayAdopt' | 'setParent'>;
  /** Record links: validated before a create, resolved per reader on the detail (R-16). */
  links: Pick<TaskRecordLinkService, 'assertLinkable' | 'linksOf'>;
  /** The reminders of a Task the reader may be shown: their own and those naming them (R-17). */
  reminders: (taskId: string) => Promise<TaskReminder[]>;
  /** The kernel's audit port — a deleted Task's former sub-tasks each get an entry (FR-029). */
  auditLog: AuditPort;
  /** `tasks.time_zone` — the calendar a date-only due date is counted in (research R-17). */
  timeZone: () => Promise<string>;
  /**
   * A sentence of this module's bundle in the reader's language — the label of
   * a context its owner did not describe (`_i18n`'s resolver, lazy).
   */
  translate: (key: string, language: SupportedLanguage) => Promise<string>;
}

const ADMIN_PERMISSION_WILDCARD = '*';

function holds(held: readonly string[], code: string): boolean {
  return held.includes(ADMIN_PERMISSION_WILDCARD) || held.includes(code);
}

/** The platform's own refusal of a write the caller's permissions do not cover (`requireAdmin`'s words). */
function forbidden(message = 'You do not have permission to perform this action.'): HttpError {
  return new HttpError(403, ERROR_CODES.FORBIDDEN, message);
}

/** A private Task is assigned to its Creator or to nobody (FR-038, R-3). */
function assertPrivateAssignees(assigneeIds: readonly string[], creatorId: string | null): void {
  if (assigneeIds.some((id) => id !== creatorId)) throw taskPrivateAssignee();
}

function personName(person: Pick<AdminUserRecord, 'firstName' | 'lastName' | 'email'>): string {
  return `${person.firstName} ${person.lastName}`.trim() || person.email;
}

function isActive(admin: AdminUserRecord): boolean {
  return admin.status === 'active' && admin.deletedAt === null;
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function asDate(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

/** A Postgres `uuid[]` literal of ids already checked to be uuids. */
function uuids(ids: readonly string[]): string {
  return `{${ids.join(',')}}`;
}

/** A Postgres `text[]` literal of codes; each is quoted, so a comma or a quote in one stays inside it. */
function texts(values: readonly string[]): string {
  return `{${values.map((value) => `"${value.replace(/["\\]/g, (m) => `\\${m}`)}"`).join(',')}}`;
}

function like(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/** Whether `context` is the context `row` is already in. */
function sameContext(
  context: { contextType: string; contextId: string; contextGroupId?: string | null | undefined } | null,
  row: Pick<TaskRow, 'context_type' | 'context_id' | 'context_group_id'>,
): boolean {
  if (context === null) return row.context_type === null;
  return (
    context.contextType === row.context_type &&
    context.contextId === row.context_id &&
    (context.contextGroupId ?? null) === row.context_group_id
  );
}

/** A status is closed when the workflow puts it in category `done` or `cancelled`. */
const CLOSED_SQL = (alias: string) =>
  `exists (select 1 from "task_statuses" cs where cs."code" = ${alias}."status" and cs."category" in ('done', 'cancelled'))`;

/** The filters the list, *My Tasks* and the board share (FR-020) — the board's query less its page size. */
export type TaskBoardFilters = Omit<TaskBoardQuery, 'perColumn'>;

/** What one page of rows needs beside the rows themselves. */
interface RowFacts {
  graph: TaskStatusGraph;
  priorities: TaskPriority[];
  timeZone: string;
  assignees: Map<string, string[]>;
  tags: Map<string, TaskTagRef[]>;
  subtasks: Map<string, { closed: number; total: number }>;
  parents: Map<string, TaskRow>;
}

export class TaskService {
  constructor(private readonly deps: TaskServiceDeps) {}

  /** One Task the caller may see, or `null` — hidden and missing alike (`TaskAccess.findVisible`). */
  async findVisibleRow(id: string): Promise<TaskRow | null> {
    return this.deps.access.findVisible(id);
  }

  /** `GET /tasks/:id`. */
  async get(id: string, language: SupportedLanguage): Promise<TaskDetail> {
    return this.#detail(await this.deps.access.loadVisible(id), language);
  }

  /** The caller's visibility scope — computed once by a request that reads several times (the board). */
  async visibilityScope(): Promise<TaskVisibilityScope> {
    return this.deps.visibility.scope();
  }

  /**
   * `GET /tasks` — a keyset page on any sort (research R-12), with every filter
   * of `TaskListQuery`. Hidden Tasks are excluded by the visibility pre-filter,
   * so a page and the next one are exact. Unknown codes and ids match nothing.
   *
   * The board asks it once per column (research R-11) with the `scope` it
   * computed once, and with the card fields its cards carry.
   */
  async list(
    query: TaskListQuery,
    language: SupportedLanguage,
    options: { scope?: TaskVisibilityScope; cardFields?: readonly TaskBoardCardField[] } = {},
  ): Promise<TaskListResponse> {
    const scope = options.scope ?? (await this.deps.visibility.scope());
    const filter = await this.#where(query, scope);
    if (filter === null) return { items: [], nextCursor: null };
    const sort = query.sort ?? 'created';
    const dir = query.dir ?? defaultDirection(sort);
    const ordering = listOrdering(sort, dir, 't');
    const where = [...filter.sql];
    const params = [...filter.params];
    const after = decodeListCursor(query.cursor, sort, dir);
    if (after) {
      const keyset = keysetAfter(sort, dir, 't', after);
      where.push(keyset.sql);
      params.push(...keyset.params);
    }
    const rows = (await this.deps.emFactory().execute(
      `select ${TASK_COLUMNS}, (${ordering.key})::text as "sort_key" from "tasks" t
        ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
        order by ${ordering.orderBy}
        limit ?`,
      [...params, query.limit + 1],
    )) as Array<TaskRow & { sort_key: string | null }>;
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    return {
      items: await this.#summaries(page, language, scope, options.cardFields),
      nextCursor: hasMore && last ? encodeListCursor({ sort, dir, key: last.sort_key, id: last.id }) : null,
    };
  }

  /**
   * `GET /tasks/count` (`specs/183-record-tab-contributions/` research R5) —
   * how many rows the list would answer under `query`'s filters, across every
   * page. The list's own conditions, the visibility pre-filter first, so the
   * count and the list never disagree. One aggregate, not cached.
   */
  async count(query: TaskBoardFilters, scope?: TaskVisibilityScope): Promise<number> {
    const filter = await this.#where(query, scope ?? (await this.deps.visibility.scope()));
    if (filter === null) return 0;
    const rows = (await this.deps.emFactory().execute(
      `select count(*)::int as "n" from "tasks" t
        ${filter.sql.length > 0 ? `where ${filter.sql.join(' and ')}` : ''}`,
      filter.params,
    )) as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * How many Tasks the caller may see in each status under `query`'s filters —
   * the board's one grouped count (research R-11). The list's own conditions,
   * so a column's count is the list's total for that status.
   */
  async countByStatus(query: TaskBoardFilters, scope: TaskVisibilityScope): Promise<Map<string, number>> {
    const filter = await this.#where(query, scope);
    if (filter === null) return new Map();
    const rows = (await this.deps.emFactory().execute(
      `select t."status", count(*)::int as "n" from "tasks" t
        ${filter.sql.length > 0 ? `where ${filter.sql.join(' and ')}` : ''}
        group by t."status"`,
      filter.params,
    )) as Array<{ status: string; n: number }>;
    return new Map(rows.map((row) => [row.status, Number(row.n)]));
  }

  /**
   * The list's filters and the custom-field filter as one condition list over
   * `tasks t`, the visibility pre-filter first; `null` when nothing can match.
   * The custom-field condition is an id sub-select over `tasks`, intersected
   * with the visible set: it narrows, never widens. A field the list does not
   * offer throws, and the route answers 400 naming it (research R-8).
   */
  async #where(query: TaskBoardFilters, scope: TaskVisibilityScope): Promise<{ sql: string[]; params: unknown[] } | null> {
    const filter = await this.#filters(query, scope);
    if (filter === null) return null;
    if (query.customFieldFilters !== undefined && Object.keys(query.customFieldFilters).length > 0) {
      const custom = await this.deps.customFieldListFilter.condition('task', query.customFieldFilters);
      if (custom) {
        filter.sql.push(`t."id" in (${custom.sql})`);
        filter.params.push(...custom.params);
      }
    }
    return filter;
  }

  /** `GET /tasks/custom-field-filters` — the `task` custom fields the list offers as filters. */
  async customFieldFilterFields(): Promise<CustomFieldListFilterField[]> {
    return this.deps.customFieldListFilter.listFilterable('task');
  }

  /**
   * The list's filters as SQL over `tasks t`, the visibility pre-filter first;
   * `null` when nothing can match (`assignee=me` or `creator=me` with no
   * administrator behind the request).
   */
  async #filters(query: TaskBoardFilters, scope: TaskVisibilityScope): Promise<{ sql: string[]; params: unknown[] } | null> {
    const sql: string[] = [];
    const params: unknown[] = [];
    const add = (fragment: SqlFragment | string) => {
      if (typeof fragment === 'string') sql.push(fragment);
      else {
        sql.push(fragment.sql);
        params.push(...fragment.params);
      }
    };
    const visible = taskVisibilitySql(scope, 't');
    if (visible) add(visible);
    const me = actingAdminUserId();

    if (query.status && query.status.length > 0) add({ sql: `t."status" = any(?::text[])`, params: [texts(query.status)] });
    if (query.statusCategory && query.statusCategory.length > 0) {
      const categories = new Set(query.statusCategory);
      const disjuncts: string[] = [];
      // A code the workflow does not hold closes nothing: it counts as open (R-1).
      if (categories.has('open')) disjuncts.push(`not ${CLOSED_SQL('t')}`);
      const closed = [...categories].filter((category) => category !== 'open');
      if (closed.length > 0) {
        disjuncts.push(
          `exists (select 1 from "task_statuses" fs where fs."code" = t."status" and fs."category" = any(?::text[]))`,
        );
        params.push(texts(closed));
      }
      sql.push(`(${disjuncts.join(' or ')})`);
    }
    if (query.assignee && query.assignee.length > 0) {
      const disjuncts: string[] = [];
      const ids = new Set<string>();
      for (const who of query.assignee) {
        if (who === 'none') disjuncts.push(`not exists (select 1 from "task_assignees" na where na."task_id" = t."id")`);
        else if (who === 'me') {
          if (me !== null) ids.add(me);
        } else ids.add(who);
      }
      if (ids.size > 0) {
        disjuncts.push(
          `exists (select 1 from "task_assignees" ya where ya."task_id" = t."id" and ya."admin_user_id" = any(?::uuid[]))`,
        );
        params.push(uuids([...ids]));
      }
      if (disjuncts.length === 0) return null;
      sql.push(`(${disjuncts.join(' or ')})`);
    }
    if (query.creator) {
      const creator = query.creator === 'me' ? me : query.creator;
      if (creator === null) return null;
      add({ sql: `t."created_by_admin_user_id" = ?::uuid`, params: [creator] });
    }
    if (query.priority && query.priority.length > 0) {
      const codes = query.priority.filter((code) => code !== 'none');
      const disjuncts: string[] = [];
      if (query.priority.includes('none')) disjuncts.push(`t."priority_code" is null`);
      if (codes.length > 0) {
        disjuncts.push(`t."priority_code" = any(?::text[])`);
        params.push(texts(codes));
      }
      sql.push(`(${disjuncts.join(' or ')})`);
    }
    for (const tagId of new Set(query.tagId ?? [])) {
      add({
        sql: `exists (select 1 from "task_tag_assignments" tg where tg."task_id" = t."id" and tg."tag_id" = ?::uuid)`,
        params: [tagId],
      });
    }
    if (query.dueFrom) add({ sql: `t."due_on" >= ?::date`, params: [query.dueFrom] });
    if (query.dueTo) add({ sql: `t."due_on" <= ?::date`, params: [query.dueTo] });
    if (query.overdue !== undefined) {
      const overdue = await this.#overdueSql('t');
      add(query.overdue ? overdue : { sql: `not ${overdue.sql}`, params: overdue.params });
    }
    if (query.linkedKind && query.linkedId) {
      add({
        sql: `exists (select 1 from "task_record_links" lk where lk."task_id" = t."id" and lk."record_kind" = ? and lk."record_id" = ?::uuid)`,
        params: [query.linkedKind, query.linkedId],
      });
    }
    if (query.contextType) add({ sql: `t."context_type" = ?`, params: [query.contextType] });
    if (query.contextId) add({ sql: `t."context_id" = ?::uuid`, params: [query.contextId] });
    if (query.parentId) add({ sql: `t."parent_task_id" = ?::uuid`, params: [query.parentId] });
    if (query.isSubtask !== undefined) add(`t."parent_task_id" is ${query.isSubtask ? 'not ' : ''}null`);
    if (query.hasSubtasks !== undefined) {
      // A sub-task the reader may not see makes no parent of a Task for them.
      const child = taskVisibilitySql(scope, 'c');
      add({
        sql: `${query.hasSubtasks ? '' : 'not '}exists (select 1 from "tasks" c where c."parent_task_id" = t."id"${child ? ` and ${child.sql}` : ''})`,
        params: child?.params ?? [],
      });
    }
    if (query.draft !== undefined) {
      // `draft=true` is only ever the caller's own drafts (R-3).
      if (query.draft) {
        if (me === null) return null;
        add({ sql: `(t."is_draft" and t."created_by_admin_user_id" = ?::uuid)`, params: [me] });
      } else add(`not t."is_draft"`);
    }
    if (query.private !== undefined) add(`${query.private ? '' : 'not '}t."is_private"`);
    if (query.q) {
      const pattern = like(query.q);
      add({ sql: `(t."title" ilike ? or t."number" ilike ?)`, params: [pattern, pattern] });
    }
    return { sql, params };
  }

  /** Open and past the due moment: at `due_at`, or once `due_on` is over in `tasks.time_zone`. */
  async #overdueSql(alias: string): Promise<SqlFragment> {
    return {
      sql: `(not ${CLOSED_SQL(alias)} and (case when ${alias}."due_at" is not null then ${alias}."due_at" < now()
        else ${alias}."due_on" < (now() at time zone ?)::date end))`,
      params: [await this.deps.timeZone()],
    };
  }

  /**
   * `GET /tasks/mine` — the caller's open, published Tasks by due date, undated
   * last, then oldest first; narrowed by visibility like the list (FR-030), and
   * by the list's filters (US3 scenario 6), `assignee=me`, `statusCategory=open`
   * and no draft implied. A `sort` orders them as the list would.
   */
  async mine(query: MyTasksQuery, language: SupportedLanguage): Promise<TaskSummary[]> {
    const me = actingAdminUserId();
    if (me === null) return [];
    const scope = await this.deps.visibility.scope();
    const filter = await this.#where(
      { ...query, assignee: ['me'], statusCategory: ['open'], draft: false },
      scope,
    );
    if (filter === null) return [];
    const orderBy = query.sort
      ? listOrdering(query.sort, query.dir ?? defaultDirection(query.sort), 't').orderBy
      : `t."due_on" asc nulls last, t."due_at" asc nulls last, t."created_at" asc, t."id" asc`;
    const rows = (await this.deps.emFactory().execute(
      `select ${TASK_COLUMNS} from "tasks" t ${filter.sql.length > 0 ? `where ${filter.sql.join(' and ')}` : ''}
        order by ${orderBy}
        limit ${TASK_MINE_MAX}`,
      filter.params,
    )) as TaskRow[];
    return this.#summaries(rows, language, scope);
  }

  /** The Tasks of `ids` the caller may see — the read port's `findByIds`, the audit trail's labels. */
  async visibleRowsByIds(ids: readonly string[]): Promise<TaskRow[]> {
    return this.#visibleRowsByIds(ids, await this.deps.visibility.scope());
  }

  async #visibleRowsByIds(ids: readonly string[], scope: TaskVisibilityScope): Promise<TaskRow[]> {
    const candidates = [...new Set(ids.filter(isUuid))];
    if (candidates.length === 0) return [];
    const where = [`t."id" = any(?::uuid[])`];
    const params: unknown[] = [uuids(candidates)];
    const visible = taskVisibilitySql(scope, 't');
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    return (await this.deps.emFactory().execute(
      `select ${TASK_COLUMNS} from "tasks" t where ${where.join(' and ')}`,
      params,
    )) as TaskRow[];
  }

  /**
   * Tasks the caller may see whose number or title contains `q`, newest first,
   * at most `limit` — `taskReadPort.search`, the `@@` document list's Tasks.
   */
  async searchVisibleRows(q: string | undefined, limit: number): Promise<TaskRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    const visible = await this.deps.visibility.condition('t');
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    const needle = (q ?? '').trim();
    if (needle !== '') {
      where.push(`(t."title" ilike ? or t."number" ilike ?)`);
      params.push(like(needle), like(needle));
    }
    return (await this.deps.emFactory().execute(
      `select ${TASK_COLUMNS} from "tasks" t
        ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
        order by t."created_at" desc, t."id" desc
        limit ?`,
      [...params, Math.max(0, Math.trunc(limit))],
    )) as TaskRow[];
  }

  /**
   * Admin global search (`contracts/admin-surfaces.md` §6): the Tasks the
   * caller may see whose number or title — whichever `fields` selects —
   * contains the text, or whose id it is. The exact number ranks first, then a
   * number it begins, then the newest; `limit + 1` rows are read to answer
   * `hasMore`. The same visibility pre-filter as the list.
   */
  async searchForAdmin(query: TaskAdminSearchQuery): Promise<{ rows: TaskAdminSearchRow[]; hasMore: boolean }> {
    const fields = new Set(query.fields);
    const pattern = `%${query.likeEscaped}%`;
    const or: string[] = [];
    const params: unknown[] = [];
    if (fields.has('number')) {
      or.push(`t."number" ilike ?`);
      params.push(pattern);
    }
    if (fields.has('title')) {
      or.push(`t."title" ilike ?`);
      params.push(pattern);
    }
    if (query.isUuid && isUuid(query.text)) {
      or.push(`t."id" = ?::uuid`);
      params.push(query.text);
    }
    if (or.length === 0) return { rows: [], hasMore: false };
    const where = [`(${or.join(' or ')})`];
    const visible = await this.deps.visibility.condition('t');
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    const rank = fields.has('number')
      ? `case when lower(t."number") = lower(?) then 0 when t."number" ilike ? then 1 else 2 end, `
      : '';
    const rankParams = fields.has('number') ? [query.text, `${query.likeEscaped}%`] : [];
    const rows = (await this.deps.emFactory().execute(
      `select ${TASK_COLUMNS} from "tasks" t
        where ${where.join(' and ')}
        order by ${rank}t."created_at" desc, t."id" desc
        limit ?`,
      [...params, ...rankParams, query.limit + 1],
    )) as TaskRow[];
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return { rows: page.map((row) => ({ id: row.id, number: row.number, title: row.title, status: row.status })), hasMore };
  }

  /** A status's name in a language, for global search's hit — the workflow's own words. */
  async statusLabel(code: string, language: SupportedLanguage): Promise<string> {
    return statusRef(await this.deps.workflow.graph(), code, language).name;
  }

  /**
   * `POST /tasks` — a Task of the caller's, in a context they may see or in
   * none, in the initial status. Every field is checked before the Command
   * runs: the assignees may read Tasks, the priority and the tags exist, the
   * custom-field values fit their definitions.
   */
  async create(body: CreateTaskBody, language: SupportedLanguage): Promise<TaskDetail> {
    const context = body.context ?? null;
    const isDraft = body.draft ?? false;
    const isPrivate = body.private ?? false;
    // The schema refuses both together; this holds the rule wherever the body came from (FR-038).
    if (isPrivate && context) throw taskPrivateInContext();
    if (context) {
      await assertContextForCaller(this.deps.contexts, context);
      await assertMayPutIn(this.deps.contexts, null, context);
    }
    const assigneeIds = [...new Set(body.assigneeIds ?? [])];
    if (isPrivate) assertPrivateAssignees(assigneeIds, actingAdminUserId());
    await assertMayBeAssigned(this.deps.adminUsers, this.deps.permissions, assigneeIds);
    await assertAssigneesSeeContext(this.deps.contexts, this.deps.adminUsers, context, assigneeIds);
    const priorityCode = body.priorityCode ?? null;
    await this.deps.priorities.assertKnown(priorityCode);
    const tagIds = [...new Set(body.tagIds ?? [])];
    await this.deps.tags.assertKnown(tagIds);
    const customFieldValues = await mergeTaskCustomFields(this.deps.customFields, {}, body.customFieldValues ?? {});
    const parentTaskId = body.parentTaskId ?? null;
    if (parentTaskId !== null) await this.deps.hierarchy.assertMayAdopt(parentTaskId);
    const links = await this.deps.links.assertLinkable(body.links ?? []);
    const due = await this.#due({ dueOn: null, dueAt: null }, body);
    const description = body.description ?? '';
    const graph = await this.deps.workflow.graph();
    const id = await this.#run(
      createTaskCommand(context, {
        title: body.title,
        description,
        assigneeIds,
        dueOn: due.dueOn ?? null,
        dueAt: due.dueAt ?? null,
        startOn: body.startOn ?? null,
        priorityCode,
        tagIds,
        customFieldValues,
        parentTaskId,
        links,
        contextNote: null,
        status: graph.initial().code,
        draft: isDraft,
        private: isPrivate,
      }),
    );
    const row = await this.deps.access.rowAfterWrite(id);
    const task = await this.#detail(row, language);
    // A draft tells nobody: it is told about when it is published (FR-037).
    if (!row.is_draft) {
      await this.#tellAssignees(assigneeIds, row);
      await this.deps.mentions.tell(row, mentionedAdminUserIds(description));
    }
    return task;
  }

  /**
   * `POST /tasks/:id/publish` — the Creator's draft becomes a normal Task, one
   * way (FR-037, research R-3): `tasks.task.created.v1` is emitted now, and its
   * assignees and the people its description mentions are told as for a new
   * Task. Somebody else's draft does not exist for the caller (404, through
   * `loadVisible`); a Task that is not a draft is 409 `TASK_ALREADY_PUBLISHED`.
   */
  async publish(id: string, language: SupportedLanguage): Promise<TaskDetail> {
    const row = await this.deps.access.loadVisible(id);
    this.deps.access.assertMayChange(row);
    if (!row.is_draft) throw taskAlreadyPublished();
    // Unreachable through visibility — a draft is its Creator's alone — and kept so.
    if (row.created_by_admin_user_id !== actingAdminUserId()) throw taskNotFound();
    const { assigneeIds } = await this.deps.commandBus.run(publishTaskCommand(row.id));
    const written = await this.deps.access.rowAfterWrite(row.id);
    const task = await this.#detail(written, language);
    await this.#tellAssignees(assigneeIds, written);
    await this.deps.mentions.tell(written, mentionedAdminUserIds(written.description));
    return task;
  }

  /** One Command, a draft/private check the database refused answered as the service would (R-3). */
  async #run<T>(command: Command<T>): Promise<T> {
    return this.deps.commandBus.run(command).catch(mapDraftPrivateViolation);
  }

  /**
   * `PATCH /tasks/:id` — one Command per kind of change, in this order, each
   * only when it changes something: the parent, the fields, the priority, the
   * tags, the custom fields, the assignees. A status is not changed here
   * (`POST /tasks/:id/status`). The parent goes first: it is the one change
   * refused inside its Command (a cycle or a depth, under the hierarchy lock),
   * so a refusal leaves the rest of the request unwritten.
   */
  async update(id: string, body: UpdateTaskBody, language: SupportedLanguage): Promise<TaskDetail> {
    const row = await this.deps.access.loadVisible(id);
    this.deps.access.assertMayChange(row);
    if (body.context !== undefined && !sameContext(body.context, row)) {
      await assertMayTakeOut(
        this.deps.contexts,
        { contextType: row.context_type, contextId: row.context_id },
        body.context,
      );
    }
    if (body.context) {
      await assertContextForCaller(this.deps.contexts, body.context);
      await assertMayPutIn(this.deps.contexts, { contextType: row.context_type, contextId: row.context_id }, body.context);
    }
    let assignees: AssigneeChange | null = null;
    if (body.assigneeIds !== undefined) assignees = { set: [...new Set(body.assigneeIds)] };
    else if (body.addAssigneeIds !== undefined || body.removeAssigneeIds !== undefined) {
      assignees = { add: body.addAssigneeIds ?? [], remove: body.removeAssigneeIds ?? [] };
    }
    if (assignees) {
      await assertMayBeAssigned(this.deps.adminUsers, this.deps.permissions, 'set' in assignees ? assignees.set : assignees.add);
    }
    // Everybody assigned after this write may see the record it is in (#506):
    // those named now, and — when the Task moves to another record — those it
    // keeps. Within one record an assignee kept from before is not asked again.
    const contextAfter =
      body.context !== undefined ? body.context : { contextType: row.context_type, contextId: row.context_id };
    const movesRecord =
      body.context != null && (body.context.contextType !== row.context_type || body.context.contextId !== row.context_id);
    if (contextAfter && (assignees || movesRecord)) {
      const current = movesRecord ? ((await this.#assigneeIds([row.id])).get(row.id) ?? []) : [];
      const asked = !assignees
        ? current
        : 'set' in assignees
          ? assignees.set
          : [...current.filter((who) => !assignees.remove.includes(who)), ...assignees.add];
      await assertAssigneesSeeContext(this.deps.contexts, this.deps.adminUsers, contextAfter, asked);
    }

    // Private (FR-038): only its Creator says so, and a private Task is in no
    // context and assigned to nobody but its Creator — as it will be after this write.
    const privacyChange = body.private !== undefined && body.private !== row.is_private;
    if (privacyChange && row.created_by_admin_user_id !== actingAdminUserId()) {
      throw forbidden('Only the administrator who created this Task can change whether it is private.');
    }
    if (body.private ?? row.is_private) {
      const contextAfter = body.context !== undefined ? body.context : row.context_type;
      if (contextAfter) throw taskPrivateInContext();
      if (privacyChange || assignees) {
        const current = (await this.#assigneeIds([row.id])).get(row.id) ?? [];
        const after = !assignees
          ? current
          : 'set' in assignees
            ? assignees.set
            : [...current.filter((who) => !assignees.remove.includes(who)), ...assignees.add];
        assertPrivateAssignees(after, row.created_by_admin_user_id);
      }
    }
    const priorityChange = body.priorityCode !== undefined && body.priorityCode !== row.priority_code;
    if (priorityChange) await this.deps.priorities.assertKnown(body.priorityCode ?? null);
    if (body.tagIds !== undefined) await this.deps.tags.assertKnown(body.tagIds);
    const customFieldValues =
      body.customFieldValues !== undefined
        ? await mergeTaskCustomFields(this.deps.customFields, row.custom_field_values ?? {}, body.customFieldValues)
        : null;

    // Made public first, so a context given in the same write lands on a public Task.
    if (privacyChange && body.private === false) await this.#run(changeTaskPrivacyCommand(row.id, false));
    if (body.parentTaskId !== undefined) await this.deps.hierarchy.setParent(row, body.parentTaskId);

    const fields: TaskFieldChanges = {};
    if (body.title !== undefined && body.title !== row.title) fields.title = body.title;
    if (body.description !== undefined && body.description !== row.description) fields.description = body.description;
    const due = await this.#due({ dueOn: row.due_on, dueAt: asDate(row.due_at) }, body);
    if (due.dueOn !== undefined && due.dueOn !== row.due_on) fields.dueOn = due.dueOn;
    if (due.dueAt !== undefined && iso(due.dueAt) !== iso(row.due_at)) fields.dueAt = due.dueAt;
    if (body.startOn !== undefined && body.startOn !== row.start_on) fields.startOn = body.startOn;
    if (body.context !== undefined && !sameContext(body.context, row)) fields.context = body.context;
    let mentioned: string[] = [];
    if (Object.keys(fields).length > 0) {
      const reminders = { timeZone: await this.deps.timeZone(), auditLog: this.deps.auditLog };
      mentioned = (await this.#run(updateTaskCommand(row.id, fields, reminders))).mentioned;
    }
    if (priorityChange) await this.deps.commandBus.run(changeTaskPriorityCommand(row.id, body.priorityCode ?? null));
    if (body.tagIds !== undefined) await this.deps.commandBus.run(changeTaskTagsCommand(row.id, body.tagIds));
    if (customFieldValues) await this.deps.commandBus.run(changeTaskCustomFieldsCommand(row.id, customFieldValues));

    let added: string[] = [];
    if (assignees) {
      const changed = await this.deps.commandBus.run(changeTaskAssigneesCommand(row.id, assignees));
      added = changed?.added ?? [];
    }
    // Made private last, once the context and the other assignees are gone.
    if (privacyChange && body.private === true) await this.#run(changeTaskPrivacyCommand(row.id, true));

    const written = await this.deps.access.rowAfterWrite(row.id);
    const task = await this.#detail(written, language);
    // A draft tells nobody until it is published (FR-037).
    if (!written.is_draft) {
      await this.#tellAssignees(added, written);
      await this.deps.mentions.tell(written, mentioned);
    }
    return task;
  }

  /**
   * The due date and moment a write leaves (research R-17, FR-002): a moment
   * sets the date to its day in `tasks.time_zone`; a date alone clears the
   * moment; clearing the moment alone keeps the date. `undefined` for what the
   * body does not change.
   */
  async #due(
    current: { dueOn: string | null; dueAt: Date | null },
    body: { dueOn?: string | null | undefined; dueAt?: string | null | undefined },
  ): Promise<{ dueOn?: string | null; dueAt?: Date | null }> {
    if (body.dueAt !== undefined && body.dueAt !== null) {
      const dueAt = new Date(body.dueAt);
      return { dueAt, dueOn: dueOnFor(dueAt, await this.deps.timeZone()) };
    }
    if (body.dueAt === null) return { dueAt: null, ...(body.dueOn !== undefined ? { dueOn: body.dueOn } : {}) };
    if (body.dueOn !== undefined) return { dueOn: body.dueOn, ...(current.dueAt !== null ? { dueAt: null } : {}) };
    return {};
  }

  /**
   * `POST /tasks/:id/status` — the move goes through {@link TaskTransitionService}
   * (research R-1: 422 `TASK_STATUS_UNKNOWN`, 409 `TASK_TRANSITION_FORBIDDEN`
   * naming the permitted next statuses, 409 `TASK_TRANSITION_CONFLICT`); the
   * answer is the Task as it is now and how many of its visible sub-tasks are
   * still open, for the screen's warning. A move to the status the Task is
   * already in changes nothing.
   */
  async changeStatus(id: string, body: TaskStatusChangeBody, language: SupportedLanguage): Promise<TaskStatusChangeResult> {
    const { taskId } = await this.deps.transitions.apply(id, body, language);
    const task = await this.#detail(await this.deps.access.rowAfterWrite(taskId), language);
    const subtasks = (await this.#subtaskCounts([taskId], await this.deps.visibility.scope())).get(taskId);
    return { task, openSubtasks: subtasks ? subtasks.total - subtasks.closed : 0 };
  }

  /**
   * `DELETE /tasks/:id` — by a holder of `tasks:write`, or of
   * `tasks:see_private` when the Task is private (FR-041); anyone else is 403
   * `FORBIDDEN`, as the route's gate would say. Its sub-tasks become top-level (FR-029), and the
   * answer says how many of them the caller may see: a sub-task hidden from
   * them is counted in no number of theirs (User Story 5 scenario 7).
   */
  async delete(id: string): Promise<TaskDeleteResult> {
    // `tasks:write`, or `tasks:see_private` on a private Task (FR-041, Q1 = B).
    const me = actingAdminUserId();
    const held = me === null ? [ADMIN_PERMISSION_WILDCARD] : await this.deps.permissions.listPermissions(me);
    const mayWrite = holds(held, 'tasks:write');
    if (!mayWrite && !holds(held, 'tasks:see_private')) throw forbidden();
    const row = await this.deps.access.loadVisible(id);
    if (!mayWrite && !row.is_private) throw forbidden();
    await this.deps.access.assertMayDelete(row);
    const { deleted, detachedIds } = await this.deps.commandBus.run(deleteTaskCommand(row.id, this.deps.auditLog));
    if (!deleted) throw taskNotFound();
    return { subtasksDetached: (await this.deps.access.visibleIds(detachedIds)).size };
  }

  /** `GET /tasks/workflow` — the statuses with how many visible Tasks hold each, and the moves. */
  async workflow(): Promise<TaskWorkflow> {
    const graph = await this.deps.workflow.graph();
    const where: string[] = [];
    const params: unknown[] = [];
    const visible = await this.deps.visibility.condition('t');
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    const counts = (await this.deps.emFactory().execute(
      `select t."status", count(*)::int as "n" from "tasks" t ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
        group by t."status"`,
      params,
    )) as Array<{ status: string; n: number }>;
    const inUse = new Map(counts.map((row) => [row.status, Number(row.n)]));
    return {
      statuses: graph.statuses.map((status) => ({
        code: status.code,
        name: status.name,
        defaultName: status.defaultName,
        category: status.category,
        isInitial: status.isInitial,
        weight: status.weight,
        color: status.color,
        inUseCount: inUse.get(status.code) ?? 0,
      })),
      transitions: graph.transitions.map((edge) => ({ from: edge.fromCode, to: edge.toCode })),
    };
  }

  /**
   * `GET /tasks/lookups/assignees` — active administrators who may be assigned,
   * by name; for a private Task (`taskId`) its Creator alone (FR-038). A Task
   * the caller may not see is 404.
   *
   * **Who may be assigned** is who the save accepts and who would see the
   * Task: a holder of `tasks:read` (`assertMayBeAssigned` refuses anybody else
   * with 422 — the walk found the list offering them, T095), and for an
   * existing Task whoever passes the Task's audience as `mentionable` asks it —
   * a Task in a record therefore offers only who may see the record
   * (`canSeeAs`, #506). A draft is asked as if published: its assignees see it
   * from then on. On the create form a `context` asks the same of the record
   * the Task is about to be created in; the caller must see it themselves, or
   * it is 422 `TASK_CONTEXT_INVALID` — the lookup answers nothing about a
   * record they may not see. A `context` with a `taskId` replaces the Task's.
   * Asked in name order, stopping at the limit, as `mentionable` does.
   */
  async assignees(
    q: string | undefined,
    taskId?: string,
    context?: { contextType: string; contextId: string },
  ): Promise<TaskAssigneeOption[]> {
    const needle = foldDiacritics(q ?? '').trim().toLowerCase();
    const task = taskId !== undefined ? await this.deps.access.loadVisible(taskId) : null;
    if (context) await this.#assertSeesContext(context);
    const only = task?.is_private ? task.created_by_admin_user_id : null;
    const facts: TaskAudienceFacts = {
      // Read only for a draft or a private Task; a Task about to be created is neither here.
      created_by_admin_user_id: task?.created_by_admin_user_id ?? actingAdminUserId() ?? '',
      is_draft: false,
      is_private: task?.is_private ?? false,
      context_type: context?.contextType ?? task?.context_type ?? null,
      context_id: context?.contextId ?? task?.context_id ?? null,
    };
    const candidates = (await this.deps.adminUsers.listAll({ activeOnly: true }))
      .filter((admin) => isActive(admin) && (only === null || admin.id === only))
      .map((admin) => ({ id: admin.id, name: personName(admin), email: admin.email }))
      .filter(
        (option) =>
          needle === '' ||
          [option.name, option.email].some((value) => foldDiacritics(value).toLowerCase().includes(needle)),
      )
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const options: TaskAssigneeOption[] = [];
    for (const option of candidates) {
      if (options.length >= ASSIGNEE_OPTIONS_LIMIT) break;
      if (await this.deps.audience(option.id, facts)) options.push(option);
    }
    return options;
  }

  /** The caller sees the record: its owner is present and lists it among theirs. */
  async #assertSeesContext(context: { contextType: string; contextId: string }): Promise<void> {
    const descriptor = this.deps.contexts.presentFor(context.contextType);
    const visible = descriptor ? await descriptor.visibleContextIds([context.contextId]) : new Set<string>();
    if (!visible.has(context.contextId)) {
      throw taskContextInvalid('The record does not exist or is not available to you.');
    }
  }

  // --- Read port --------------------------------------------------------------

  /**
   * The Tasks of one context (or one group inside it), oldest first — what the
   * read port answers. The context's own owner is asked once whether the
   * caller may see it, and the draft/private rule applies; the system is not
   * narrowed. `openOnly`: not closed and not a draft — the completion gate's
   * question (R-1, R-3).
   */
  async rowsInContext(q: TaskContextQuery, options: { openOnly: boolean }): Promise<TaskRow[]> {
    const filter = await this.#inContext(q);
    if (!filter) return [];
    return (await this.deps.emFactory().execute(
      `select ${TASK_COLUMNS} from "tasks" t where ${filter.sql}
         ${options.openOnly ? `and not ${CLOSED_SQL('t')} and not t."is_draft"` : ''}
        order by t."created_at" asc, t."id" asc`,
      filter.params,
    )) as TaskRow[];
  }

  async countInContext(q: TaskContextQuery): Promise<number> {
    const filter = await this.#inContext(q);
    if (!filter) return 0;
    const rows = (await this.deps.emFactory().execute(
      `select count(*)::int as "n" from "tasks" t where ${filter.sql}`,
      filter.params,
    )) as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  }

  /** The predicate selecting one context's Tasks the caller may see, or `null` when the context is hidden. */
  async #inContext(q: TaskContextQuery): Promise<SqlFragment | null> {
    if (!isUuid(q.contextId) || (q.contextGroupId !== undefined && !isUuid(q.contextGroupId))) return null;
    const visibleContext = await this.deps.visibility.canSeeContext({ contextType: q.contextType, contextId: q.contextId });
    if (!visibleContext) return null;
    const sql = [`t."context_type" = ?`, `t."context_id" = ?`];
    const params: unknown[] = [q.contextType, q.contextId];
    if (q.contextGroupId !== undefined) {
      sql.push(`t."context_group_id" = ?`);
      params.push(q.contextGroupId);
    }
    const viewer = await this.deps.visibility.viewer();
    if (viewer) {
      // The context is visible; the draft/private conjunct still applies.
      const scope: TaskVisibilityScope = {
        unrestricted: false,
        contexts: [{ contextType: q.contextType, ids: [q.contextId] }],
        viewer,
      };
      const visible = taskVisibilitySql(scope, 't')!;
      sql.push(visible.sql);
      params.push(...visible.params);
    }
    return { sql: sql.join(' and '), params };
  }

  /** Rows as they cross a module boundary — plain records, never the entity. */
  async records(rows: readonly TaskRow[]): Promise<TaskRecord[]> {
    if (rows.length === 0) return [];
    const [graph, assignees] = await Promise.all([this.deps.workflow.graph(), this.#assigneeIds(rows.map((r) => r.id))]);
    return rows.map((row) => {
      const def = graph.get(row.status);
      const category = def?.category ?? 'open';
      return {
        id: row.id,
        number: row.number,
        title: row.title,
        status: row.status,
        statusCategory: category,
        statusName: def?.name ?? {},
        statusDefaultName: def?.defaultName || row.status,
        statusColor: def?.color ?? '#94a3b8',
        closed: category !== 'open',
        dueOn: row.due_on,
        dueAt: asDate(row.due_at),
        assigneeIds: assignees.get(row.id) ?? [],
        draft: row.is_draft,
        private: row.is_private,
        contextType: row.context_type,
        contextId: row.context_id,
        contextGroupId: row.context_group_id,
        contextNote: row.context_note,
        completedAt: asDate(row.completed_at),
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };
    });
  }

  // --- Assignment notifications (FR-032, research R-2) -------------------------

  /**
   * Each newly added assignee other than the caller is told once, after commit,
   * and only when they may see the Task (`mention-service.ts`'s audience: they
   * hold `tasks:read`, F-14, and the context's owner says they may see it). A
   * bell is read outside any visibility, and a number must not reach someone
   * the Task is hidden from. An owner that is not present vouches for nobody.
   */
  async #tellAssignees(added: readonly string[], row: TaskRow): Promise<void> {
    const me = actingAdminUserId();
    for (const assignee of added) {
      if (assignee === me) continue;
      await tellAfterCommit(row.id, async () => {
        if (!(await this.deps.audience(assignee, row))) return;
        await this.deps.notifier.assigned({ targetAdminUserId: assignee, taskId: row.id, number: row.number });
      });
    }
  }

  // --- Shaping rows for the reader ---------------------------------------------

  async #detail(row: TaskRow, language: SupportedLanguage): Promise<TaskDetail> {
    const scope = await this.deps.visibility.scope();
    const [[summary], subtaskRows, relatedRows, counts, creator, me] = await Promise.all([
      this.#summaries([row], language, scope),
      this.#visibleChildren(row.id, scope),
      this.#visibleRelated(row.id, scope),
      this.#collaborationCounts(row.id),
      this.#people([row.created_by_admin_user_id]).then((people) => people.get(row.created_by_admin_user_id)),
      Promise.resolve(actingAdminUserId()),
    ]);
    const [references, customFieldValues, links, reminders] = await Promise.all([
      this.deps.references.resolve(row.description),
      this.deps.customFields.project('task', row.custom_field_values ?? {}),
      this.deps.links.linksOf(row.id),
      this.deps.reminders(row.id),
    ]);
    const held = me === null ? [] : await this.deps.permissions.listPermissions(me);
    const contextAvailable = summary!.context?.available ?? false;
    const canChangeTasks = await this.#mayChangeTasks(row, contextAvailable);
    const mayWrite = holds(held, 'tasks:write');
    return {
      ...summary!,
      description: row.description,
      references,
      context:
        summary!.context && row.context_id
          ? { ...summary!.context, id: row.context_id, groupId: row.context_group_id, canChangeTasks }
          : null,
      contextNote: await this.#note(row, language),
      startOn: row.start_on,
      customFieldValues,
      links,
      relatedTasks: await this.#summaries(relatedRows, language, scope),
      subtaskItems: await this.#summaries(subtaskRows, language, scope),
      attachmentsCount: counts.attachments,
      commentsCount: counts.comments,
      reminders,
      createdBy: creator ? { id: creator.id, name: personName(creator) } : null,
      publishedAt: iso(row.published_at),
      completedAt: iso(row.completed_at),
      permissions: {
        canChange: mayWrite && !isSomeoneElsesPrivate(row),
        canDelete:
          (mayWrite || (row.is_private && holds(held, 'tasks:see_private'))) &&
          (row.context_type === null || canChangeTasks),
        canPublish: row.is_draft && me !== null && row.created_by_admin_user_id === me,
      },
    };
  }

  /** The visible sub-tasks of one Task, oldest first. */
  async #visibleChildren(parentId: string, scope: TaskVisibilityScope): Promise<TaskRow[]> {
    const where = [`t."parent_task_id" = ?::uuid`];
    const params: unknown[] = [parentId];
    const visible = taskVisibilitySql(scope, 't');
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    return (await this.deps.emFactory().execute(
      `select ${TASK_COLUMNS} from "tasks" t where ${where.join(' and ')} order by t."created_at" asc, t."id" asc`,
      params,
    )) as TaskRow[];
  }

  /**
   * The Tasks related to one Task that the reader may see, by number (FR-030):
   * the pairs are read by the visible Task's id, and the other side through
   * the visibility pre-filter.
   */
  async #visibleRelated(taskId: string, scope: TaskVisibilityScope): Promise<TaskRow[]> {
    const pairs = (await this.deps.emFactory().execute(
      `select case when r."task_a_id" = ?::uuid then r."task_b_id" else r."task_a_id" end as "id"
         from "task_relations" r where r."task_a_id" = ?::uuid or r."task_b_id" = ?::uuid`,
      [taskId, taskId, taskId],
    )) as Array<{ id: string }>;
    const rows = await this.#visibleRowsByIds(
      pairs.map((pair) => pair.id),
      scope,
    );
    return rows.sort((a, b) => a.number.localeCompare(b.number) || a.id.localeCompare(b.id));
  }

  /** How many attachments and live comments one visible Task has. */
  async #collaborationCounts(taskId: string): Promise<{ attachments: number; comments: number }> {
    const [row] = (await this.deps.emFactory().execute(
      `select (select count(*)::int from "task_attachments" a where a."task_id" = ?) as "attachments",
              (select count(*)::int from "task_comments" c where c."task_id" = ? and c."deleted_at" is null) as "comments"`,
      [taskId, taskId],
    )) as Array<{ attachments: number; comments: number }>;
    return { attachments: Number(row?.attachments ?? 0), comments: Number(row?.comments ?? 0) };
  }

  /**
   * The context owner's `canChangeTasks` for the reader, so a screen does not
   * offer a Delete or a move the server would refuse (163 T147). An
   * unavailable context answers `false`.
   */
  async #mayChangeTasks(row: TaskRow, available: boolean): Promise<boolean> {
    if (!available || row.context_type === null || row.context_id === null) return false;
    const descriptor = this.deps.contexts.presentFor(row.context_type);
    return descriptor ? descriptor.canChangeTasks(row.context_id) : false;
  }

  /**
   * The Task's note in the reader's language — worded by the context's owner
   * when it says how (`renderNote`), otherwise as it was stored.
   */
  async #note(row: TaskRow, language: SupportedLanguage): Promise<string | null> {
    if (row.context_note === null || !row.context_type) return row.context_note;
    const descriptor = this.deps.contexts.presentFor(row.context_type);
    return descriptor?.renderNote ? descriptor.renderNote(row.context_note, language) : row.context_note;
  }

  async #summaries(
    rows: readonly TaskRow[],
    language: SupportedLanguage,
    scope: TaskVisibilityScope,
    cardFields?: readonly TaskBoardCardField[],
  ): Promise<TaskSummary[]> {
    if (rows.length === 0) return [];
    const facts = await this.#facts(rows, scope);
    const people = await this.#people([...new Set([...facts.assignees.values()].flat())]);
    const descriptions = await this.#describe(rows);
    let unavailable: string | null = null;
    const contextOf = async (row: TaskRow): Promise<TaskContextSummary | null> => {
      if (!row.context_type || !row.context_id) return null;
      const description = descriptions.get(row.context_type)?.get(row.context_id);
      if (description && description.label !== '') {
        return {
          type: row.context_type,
          available: true,
          label: description.label,
          href: description.href || null,
          groupLabel: (row.context_group_id && description.groups.get(row.context_group_id)) || null,
        };
      }
      // Fail closed: the owner did not describe the record — gone since the
      // visibility check, or its owner answered for fewer ids than asked.
      unavailable ??= await this.deps.translate('context.unavailable', language);
      return { type: row.context_type, available: false, label: unavailable, href: null, groupLabel: null };
    };
    const contexts: Array<TaskContextSummary | null> = [];
    for (const row of rows) contexts.push(await contextOf(row));
    const now = new Date();
    const summaries = rows.map((row, index): TaskSummary => {
      const status = statusRef(facts.graph, row.status, language);
      const closed = status.category !== 'open';
      const parent = row.parent_task_id ? facts.parents.get(row.parent_task_id) : undefined;
      return {
        id: row.id,
        number: row.number,
        title: row.title,
        status,
        closed,
        assignees: (facts.assignees.get(row.id) ?? []).flatMap((id) => {
          const person = people.get(id);
          return person ? [{ id: person.id, name: personName(person), active: isActive(person) }] : [];
        }),
        dueOn: row.due_on,
        dueAt: iso(row.due_at),
        overdue: isOverdue({ closed, dueOn: row.due_on, dueAt: asDate(row.due_at) }, now, facts.timeZone),
        priority: priorityRef(facts.priorities, row.priority_code, language),
        tags: facts.tags.get(row.id) ?? [],
        context: contexts[index] ?? null,
        parent: row.parent_task_id
          ? { id: row.parent_task_id, number: parent?.number ?? null, available: parent !== undefined }
          : null,
        subtasks: facts.subtasks.get(row.id) ?? { closed: 0, total: 0 },
        draft: row.is_draft,
        private: row.is_private,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
    });
    if (!cardFields) return summaries;
    // The board's cards (FR-022): the chosen fields' values, off the summary
    // and the two columns it does not carry.
    return summaries.map((summary, index) => ({
      ...summary,
      cardFields: cardFieldValues(cardFields, summary, {
        startOn: rows[index]!.start_on,
        customFieldValues: rows[index]!.custom_field_values,
      }),
    }));
  }

  /** Everything a page of rows needs beside itself, one query per kind, all keyed by the page's ids. */
  async #facts(rows: readonly TaskRow[], scope: TaskVisibilityScope): Promise<RowFacts> {
    const ids = rows.map((row) => row.id);
    const parentIds = [...new Set(rows.map((row) => row.parent_task_id).filter((id): id is string => id !== null))];
    const [graph, priorities, timeZone, assignees, tags, subtasks, parents] = await Promise.all([
      this.deps.workflow.graph(),
      this.deps.workflow.priorities(),
      this.deps.timeZone(),
      this.#assigneeIds(ids),
      this.#tags(ids),
      this.#subtaskCounts(ids, scope),
      this.#visibleRowsByIds(parentIds, scope),
    ]);
    return { graph, priorities, timeZone, assignees, tags, subtasks, parents: new Map(parents.map((p) => [p.id, p])) };
  }

  /** The assignees of each Task, in the order they were given it. */
  async #assigneeIds(taskIds: readonly string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (taskIds.length === 0) return out;
    const rows = (await this.deps.emFactory().execute(
      `select a."task_id", a."admin_user_id" from "task_assignees" a where a."task_id" = any(?::uuid[])
        order by a."assigned_at" asc, a."admin_user_id" asc`,
      [uuids(taskIds)],
    )) as Array<{ task_id: string; admin_user_id: string }>;
    for (const row of rows) out.set(row.task_id, [...(out.get(row.task_id) ?? []), row.admin_user_id]);
    return out;
  }

  /** The tags of each Task, by name. */
  async #tags(taskIds: readonly string[]): Promise<Map<string, TaskTagRef[]>> {
    const out = new Map<string, TaskTagRef[]>();
    if (taskIds.length === 0) return out;
    const rows = (await this.deps.emFactory().execute(
      `select ta."task_id", g."id", g."name", g."color" from "task_tag_assignments" ta
         join "task_tags" g on g."id" = ta."tag_id"
        where ta."task_id" = any(?::uuid[])
        order by lower(g."name") asc, g."id" asc`,
      [uuids(taskIds)],
    )) as Array<{ task_id: string; id: string; name: string; color: string }>;
    for (const row of rows) {
      out.set(row.task_id, [...(out.get(row.task_id) ?? []), { id: row.id, name: row.name, color: row.color }]);
    }
    return out;
  }

  /** Each Task's sub-tasks the reader may see, closed and in all (FR-028). */
  async #subtaskCounts(taskIds: readonly string[], scope: TaskVisibilityScope): Promise<Map<string, { closed: number; total: number }>> {
    const out = new Map<string, { closed: number; total: number }>();
    if (taskIds.length === 0) return out;
    const where = [`c."parent_task_id" = any(?::uuid[])`];
    const params: unknown[] = [uuids(taskIds)];
    const visible = taskVisibilitySql(scope, 'c');
    if (visible) {
      where.push(visible.sql);
      params.push(...visible.params);
    }
    const rows = (await this.deps.emFactory().execute(
      `select c."parent_task_id", count(*)::int as "total", count(*) filter (where ${CLOSED_SQL('c')})::int as "closed"
         from "tasks" c where ${where.join(' and ')} group by c."parent_task_id"`,
      params,
    )) as Array<{ parent_task_id: string; total: number; closed: number }>;
    for (const row of rows) out.set(row.parent_task_id, { closed: Number(row.closed), total: Number(row.total) });
    return out;
  }

  async #people(ids: readonly string[]): Promise<Map<string, AdminUserRecord>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const found = await this.deps.adminUsers.findByIds(unique);
    return new Map(found.map((admin) => [admin.id, admin]));
  }

  /**
   * What each context's owner says about the contexts of `rows`, asked once
   * per type, under the caller's context. Only a present owner is asked.
   */
  async #describe(rows: readonly TaskRow[]): Promise<Map<string, Map<string, TaskContextDescription>>> {
    const byType = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!row.context_type || !row.context_id) continue;
      const ids = byType.get(row.context_type) ?? new Set<string>();
      ids.add(row.context_id);
      byType.set(row.context_type, ids);
    }
    const out = new Map<string, Map<string, TaskContextDescription>>();
    for (const [contextType, ids] of byType) {
      const descriptor = this.deps.contexts.presentFor(contextType);
      if (!descriptor) continue;
      out.set(contextType, await descriptor.describe([...ids]));
    }
    return out;
  }
}
