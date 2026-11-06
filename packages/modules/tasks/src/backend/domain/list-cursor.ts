import { ERROR_CODES, type TaskListSort, type TaskSortDirection, isUuidShape } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Keyset paging on any sort of the Tasks list — pure (`specs/165-task-management/`
 * research R-12).
 *
 * Each sort is one **key** expression over `tasks` aliased `alias`, ordered with
 * **nulls last** in both directions and broken by the id. The cursor is
 * base64url JSON `{s, d, k, i}`: the sort and direction it was issued for, the
 * key of the last row as text (`null` when that row had none) and its id. A
 * cursor read back under another sort or direction, or one this module did not
 * write, is a malformed request (400), never "page one".
 *
 * For `priority` and `status` the key is the joined weight, so the order is the
 * operator's, and a Task without a priority — or with a status the workflow no
 * longer holds — has no key and sorts last.
 */

type KeyType = 'timestamptz' | 'text' | 'int';

interface SortKey {
  key: (alias: string) => string;
  type: KeyType;
  /** The direction a list without `dir` takes. */
  defaultDir: TaskSortDirection;
}

const SORT_KEYS: Record<TaskListSort, SortKey> = {
  created: { key: (a) => `${a}."created_at"`, type: 'timestamptz', defaultDir: 'desc' },
  updated: { key: (a) => `${a}."updated_at"`, type: 'timestamptz', defaultDir: 'desc' },
  // `TSK-` and a zero-padded number: text order is number order.
  number: { key: (a) => `${a}."number"`, type: 'text', defaultDir: 'desc' },
  title: { key: (a) => `lower(${a}."title")`, type: 'text', defaultDir: 'asc' },
  // The day, then the moment inside it; a date-only Task after the timed ones of its day.
  due: {
    key: (a) =>
      `(to_char(${a}."due_on", 'YYYY-MM-DD') || coalesce(to_char(${a}."due_at" at time zone 'UTC', '"T"HH24:MI:SS.US'), 'T~'))`,
    type: 'text',
    defaultDir: 'asc',
  },
  priority: {
    key: (a) => `(select p."weight" from "task_priorities" p where p."code" = ${a}."priority_code")`,
    type: 'int',
    defaultDir: 'asc',
  },
  status: {
    key: (a) => `(select s."weight" from "task_statuses" s where s."code" = ${a}."status")`,
    type: 'int',
    defaultDir: 'asc',
  },
};

export function defaultDirection(sort: TaskListSort): TaskSortDirection {
  return SORT_KEYS[sort].defaultDir;
}

export interface ListOrdering {
  /** The key expression; select it as text to build the next cursor. */
  key: string;
  /** The `order by` body: the key, nulls last, then the id, in one direction. */
  orderBy: string;
}

export function listOrdering(sort: TaskListSort, dir: TaskSortDirection, alias: string): ListOrdering {
  const key = SORT_KEYS[sort].key(alias);
  return { key, orderBy: `${key} ${dir} nulls last, ${alias}."id" ${dir}` };
}

export interface ListPosition {
  /** The last row's key as text; `null` when it had none. */
  key: string | null;
  id: string;
}

export function encodeListCursor(input: { sort: TaskListSort; dir: TaskSortDirection } & ListPosition): string {
  return Buffer.from(JSON.stringify({ s: input.sort, d: input.dir, k: input.key, i: input.id }), 'utf8').toString(
    'base64url',
  );
}

function tampered(): HttpError {
  return new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The cursor is not one this list issued.');
}

/** The position a cursor names, `null` for none; 400 for a cursor this sort did not issue. */
export function decodeListCursor(
  cursor: string | undefined,
  sort: TaskListSort,
  dir: TaskSortDirection,
): ListPosition | null {
  if (!cursor) return null;
  let parsed: { s?: unknown; d?: unknown; k?: unknown; i?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as typeof parsed;
  } catch {
    throw tampered();
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    parsed.s !== sort ||
    parsed.d !== dir ||
    typeof parsed.i !== 'string' ||
    !isUuidShape(parsed.i) ||
    !(parsed.k === null || typeof parsed.k === 'string')
  ) {
    throw tampered();
  }
  return { key: parsed.k, id: parsed.i };
}

export interface SqlFragment {
  readonly sql: string;
  readonly params: unknown[];
}

/** The rows after `position` in this order — nulls last, so a keyless row follows every keyed one. */
export function keysetAfter(
  sort: TaskListSort,
  dir: TaskSortDirection,
  alias: string,
  position: ListPosition,
): SqlFragment {
  const { key, type } = { key: SORT_KEYS[sort].key(alias), type: SORT_KEYS[sort].type };
  const id = `${alias}."id"`;
  const op = dir === 'asc' ? '>' : '<';
  if (position.key === null) {
    return { sql: `(${key} is null and ${id} ${op} ?::uuid)`, params: [position.id] };
  }
  return {
    sql: `(${key} ${op} ?::${type} or (${key} = ?::${type} and ${id} ${op} ?::uuid) or ${key} is null)`,
    params: [position.key, position.key, position.id],
  };
}
