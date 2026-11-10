import {
  ERROR_CODES,
  type AdminUserReadPort,
  type RecordHistoryPage,
  type RecordHistoryQuery,
} from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { actingAdminUserId, type TaskAccess } from './task-access.js';
import { taskNotFound } from './task-errors.js';
import type { TaskService } from './task-service.js';
import type { TaskVisibility } from './task-visibility.js';

/** The object type every Command about a Task is recorded under. */
export const TASK_AUDIT_OBJECT_TYPE = 'task';

/** The most the audit port answers in one read (`AuditPort.query`), whatever is asked. */
const AUDIT_QUERY_CAP = 500;

/**
 * How far back a history reaches: one entry fewer than the cap, so a read that
 * comes back full proves an earlier entry exists and the last page says so
 * (`truncated`) — CRM's `opportunity-history-service.ts`, the model.
 */
export const TASK_HISTORY_REACH = AUDIT_QUERY_CAP - 1;

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    if (typeof parsed.o === 'number' && Number.isInteger(parsed.o) && parsed.o >= 0) return parsed.o;
  } catch {
    // Falls through: a cursor this service did not issue is a malformed request.
  }
  throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The cursor is not one this history issued.');
}

export interface TaskHistoryServiceDeps {
  /** Reads the Task's own value store (#470), by the id of a Task the reader may see. */
  emFactory: () => EntityManager;
  tasks: Pick<TaskService, 'findVisibleRow'>;
  /** Whether the reader may see a context an entry names — the Task may have left it since. */
  visibility: Pick<TaskVisibility, 'canSeeContext'>;
  /** Which of the Tasks an entry names the reader may see. */
  access: Pick<TaskAccess, 'visibleIds'>;
  /** The kernel's audit port — a platform service. */
  auditLog: Pick<AuditPort, 'query'>;
  /** `admin_users`' read port — lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
}

/**
 * `GET /tasks/:id/history` — **the audit log is the history**: every write of
 * a Task is a Command recorded against `task` and its id. The Task is read
 * through the visibility seam first, so a Task the caller may not see answers
 * 404 here exactly as it does by id. Served to `tasks:read`, not
 * `audit_log:read`.
 *
 * Audit states carry no description text (`task-commands.ts`), so an entry
 * resolves no reference tokens: `references` is always empty.
 *
 * Seeing the Task today does not mean seeing every context it was ever in: a
 * Task that left a Project the reader may not see still names it in its older
 * entries. Such a context is served blank — its type, id, group and note —
 * as {@link withoutContext} states (T144 F4).
 *
 * Nor does it mean seeing every Task an entry names (T093 F3): a related or
 * parent Task the reader may not see — private, a draft, in a hidden context,
 * or deleted — is served as `null`, the same as no Task at all
 * ({@link TASK_ID_KEYS}).
 *
 * And a reminder is shown only to whoever set it and to those it names, as
 * `GET /tasks/:id/reminders` shows it (admin-api §1): any other reader's
 * history **leaves out** a `tasks.reminder.*` entry altogether, as the
 * reminders list leaves the reminder out — redacting its state would still
 * say that a reminder exists. Paging counts the entries the reader is shown.
 */
const CONTEXT_KEYS = ['contextType', 'contextId', 'contextGroupId', 'contextNote'] as const;

/** The audited keys whose value is a Task's id (relation and hierarchy entries). */
export const TASK_ID_KEYS = ['relatedTaskId', 'parentTaskId'] as const;

/** The action prefix of every entry about one reminder. */
const REMINDER_ACTION_PREFIX = 'tasks.reminder.';

function asRecord(state: unknown): Record<string, unknown> | null {
  return state !== null && typeof state === 'object' && !Array.isArray(state) ? (state as Record<string, unknown>) : null;
}

/** The Task ids an audited state names. */
function taskIdsOf(state: unknown): string[] {
  const record = asRecord(state);
  if (!record) return [];
  return TASK_ID_KEYS.map((key) => record[key]).filter((value): value is string => typeof value === 'string');
}

/**
 * Whether `reader` may be shown a reminder entry: they set the reminder or it
 * names them. The setter is recorded as `createdById`; an entry recording a
 * reminder being set names no setter but its actor, who set it.
 */
function showsReminder(
  entry: { action: string; actorAdminUserId?: string | null; stateBefore?: unknown; stateAfter?: unknown },
  reader: string | null,
): boolean {
  if (!entry.action.startsWith(REMINDER_ACTION_PREFIX)) return true;
  if (reader === null) return false;
  const state = asRecord(entry.stateAfter) ?? asRecord(entry.stateBefore);
  if (!state) return false;
  const setter = typeof state['createdById'] === 'string'
    ? state['createdById']
    : entry.action === 'tasks.reminder.add' ? (entry.actorAdminUserId ?? null) : null;
  if (setter === reader) return true;
  return Array.isArray(state['recipientIds']) && state['recipientIds'].includes(reader);
}

/** The audit keys that stand in for the values the Task's own store keeps (#470). */
const VALUE_POINTER = 'valueChangeId';
const VALUE_NAMES = ['changedFields', 'changedCustomFields'] as const;

/** One row of `task_value_changes`: the changed values of one write, either side. */
export interface StoredTaskValueChange {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `task_value_changes` row an entry points at — on the side that has one — or `null`. */
export function valueChangeIdOf(entry: { before: unknown; after: unknown }): string | null {
  for (const state of [entry.after, entry.before]) {
    const id = asRecord(state)?.[VALUE_POINTER];
    if (typeof id === 'string' && UUID_SHAPE.test(id)) return id;
  }
  return null;
}

/**
 * An entry with the values the Task's store kept for it (#470): the audit entry
 * names what changed and points at the row by `valueChangeId`; the history
 * serves the values in place of the names, in the shape entries written before
 * #470 carried them. Without a row the names stay and only the pointer goes.
 * Entries written before #470 carry their values and are served as stored
 * (owner ruling O-4, 2026-11-10).
 */
export function withStoredValues(
  entry: { before: unknown; after: unknown },
  change: StoredTaskValueChange | null,
): { before: unknown; after: unknown } {
  const strip = (state: unknown): unknown => {
    const record = asRecord(state);
    if (!record || !(VALUE_POINTER in record || (change && VALUE_NAMES.some((key) => key in record)))) return state;
    const out = { ...record };
    delete out[VALUE_POINTER];
    if (change) for (const key of VALUE_NAMES) delete out[key];
    return out;
  };
  const merge = (state: unknown, values: Record<string, unknown> | null): unknown => {
    const stripped = strip(state);
    if (!values) return stripped;
    return { ...(asRecord(stripped) ?? {}), ...values };
  };
  return { before: merge(entry.before, change?.before ?? null), after: merge(entry.after, change?.after ?? null) };
}

/** An audited state with its context blanked. */
export function withoutContext(state: Record<string, unknown>): Record<string, unknown> {
  const out = { ...state };
  for (const key of CONTEXT_KEYS) if (Object.hasOwn(out, key)) out[key] = null;
  return out;
}

/** The context an audited state names, if any. */
function contextOf(state: unknown): { contextType: string; contextId: string } | null {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return null;
  const { contextType, contextId } = state as Record<string, unknown>;
  return typeof contextType === 'string' && typeof contextId === 'string' ? { contextType, contextId } : null;
}

export class TaskHistoryService {
  constructor(private readonly deps: TaskHistoryServiceDeps) {}

  async list(taskId: string, query: RecordHistoryQuery): Promise<RecordHistoryPage> {
    const offset = decodeCursor(query.cursor);
    const task = await this.deps.tasks.findVisibleRow(taskId);
    if (!task) throw taskNotFound();

    const read = await this.deps.auditLog.query({
      objectType: TASK_AUDIT_OBJECT_TYPE,
      objectId: task.id,
      // The whole reach: an entry the reader is not shown must not count
      // towards a page, so the shown entries are known before paging.
      limit: AUDIT_QUERY_CAP,
    });
    const reader = actingAdminUserId();
    const entries = read.slice(0, TASK_HISTORY_REACH).filter((entry) => showsReminder(entry, reader));
    const page = entries.slice(offset, offset + query.limit);
    const hasMore = entries.length > offset + query.limit;
    const truncated = !hasMore && read.length > TASK_HISTORY_REACH;

    // The values the page's entries name, from the Task's own store — keyed by
    // the Task `findVisibleRow` handed out, so a pointer to another Task's row
    // reads nothing (#470).
    const pointers = page
      .map((entry) => valueChangeIdOf({ before: entry.stateBefore ?? null, after: entry.stateAfter ?? null }))
      .filter((id): id is string => id !== null);
    const changes = await this.#valueChanges(task.id, pointers);
    const states = page.map((entry) => {
      const raw = { before: entry.stateBefore ?? null, after: entry.stateAfter ?? null };
      const pointer = valueChangeIdOf(raw);
      return withStoredValues(raw, pointer === null ? null : (changes.get(pointer) ?? null));
    });

    const actorIds = [...new Set(page.map((entry) => entry.actorAdminUserId).filter((id): id is string => Boolean(id)))];
    const actors = actorIds.length > 0 ? await this.deps.adminUsers.findByIds(actorIds) : [];
    const names = new Map(actors.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]));

    // Each context the page names, asked once, under the reader's own context.
    const seen = new Map<string, boolean>();
    for (const entry of states) {
      for (const state of [entry.before, entry.after]) {
        const context = contextOf(state);
        if (!context) continue;
        const key = `${context.contextType}:${context.contextId}`;
        if (!seen.has(key)) seen.set(key, await this.deps.visibility.canSeeContext(context));
      }
    }
    // Every Task the page names, asked once, in one read.
    const named = states.flatMap((entry) => [...taskIdsOf(entry.before), ...taskIdsOf(entry.after)]);
    const visibleTasks = named.length > 0 ? await this.deps.access.visibleIds(named) : new Set<string>();
    const withoutHiddenTasks = (state: unknown): unknown => {
      const record = asRecord(state);
      if (!record || !TASK_ID_KEYS.some((key) => typeof record[key] === 'string' && !visibleTasks.has(record[key]))) {
        return state;
      }
      const out = { ...record };
      for (const key of TASK_ID_KEYS) {
        if (typeof out[key] === 'string' && !visibleTasks.has(out[key])) out[key] = null;
      }
      return out;
    };
    const served = (state: unknown): unknown => {
      const context = contextOf(state);
      if (!context || seen.get(`${context.contextType}:${context.contextId}`)) return withoutHiddenTasks(state ?? null);
      return withoutHiddenTasks(withoutContext(state as Record<string, unknown>));
    };

    return {
      data: page.map((entry, index) => {
        const actorId = entry.actorAdminUserId ?? null;
        return {
          id: entry.id,
          actedAt: entry.actedAt.toISOString(),
          action: entry.action,
          actor:
            actorId === null
              ? { kind: 'system', id: null, name: null }
              : { kind: 'admin', id: actorId, name: names.get(actorId) ?? null },
          before: served(states[index]?.before ?? null),
          after: served(states[index]?.after ?? null),
          references: [],
        };
      }),
      pagination: { cursor: hasMore ? encodeCursor(offset + query.limit) : null, hasMore, limit: query.limit },
      truncated,
    };
  }

  /** The stored values of the page's entries, by row id — read by the Task's own id. */
  async #valueChanges(taskId: string, ids: readonly string[]): Promise<Map<string, StoredTaskValueChange>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.deps.emFactory().execute(
      `select v."id", v."before", v."after" from "task_value_changes" v
        where v."task_id" = ? and v."id" = any(?::uuid[])`,
      [taskId, `{${ids.join(',')}}`],
    )) as Array<{ id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>;
    return new Map(rows.map((row) => [row.id, { before: row.before, after: row.after }]));
  }
}
