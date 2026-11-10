import type { EntityManager } from '@mikro-orm/postgresql';
import { isDeepStrictEqual } from 'node:util';
import { TaskValueChange, type TaskValueState } from '../entities/task-value-change.entity.js';

/**
 * What a `tasks.*` audit entry may say about a Task, and where the rest goes
 * (issue #470, D-288; `specs/conventions/audit-state.md`).
 *
 * The platform audit log is one global table read under `audit_log:read`, so a
 * Task's entry carries names and structure: its number, codes, dates, ids,
 * booleans, lengths and the names of what changed. Its title (owner ruling O-1,
 * 2026-11-10: a title is a value), its context note, its custom-field values
 * and an attachment's file name go to `task_value_changes`, written in the same
 * Command; the entry carries that row's id as `valueChangeId`, and the Task's
 * history serves the values from there (`task-history-service.ts`).
 */

/**
 * Every top-level key a Task's audit snapshot may hold. A new field of the
 * snapshot is a value until somebody classifies it on purpose —
 * `task-audit-sentinels.test.ts` holds the snapshot to this list.
 */
export const TASKS_AUDIT_KEYS: ReadonlySet<string> = new Set([
  'number',
  'descriptionLength',
  'status',
  'dueOn',
  'dueAt',
  'startOn',
  'completedAt',
  'contextType',
  'contextId',
  'contextGroupId',
  'changedFields',
  'changedCustomFields',
  'valueChangeId',
]);

/** What an audit entry says of a value change: the names, and the store row. */
export interface TaskValueChangeKeys {
  changedFields?: string[];
  changedCustomFields?: string[];
  valueChangeId?: string;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

/**
 * Record what a write changed among the values the audit log may not hold:
 * a {@link TaskValueChange} row in the Command's transaction, and the keys the
 * entry carries instead (`changedFields`, `changedCustomFields`, sorted and
 * each only when non-empty; `valueChangeId`). `before: null` is something that
 * only arrived, `after: null` something that went; `customFieldValues` is
 * compared key by key. Nothing changed writes no row and answers `{}`.
 *
 * Call it inside a Command, with that Command's EntityManager and a Task that
 * was reached through `TaskAccess`.
 */
export function recordTaskValueChange(
  em: EntityManager,
  taskId: string,
  change: { before: TaskValueState | null; after: TaskValueState | null },
): TaskValueChangeKeys {
  const before = change.before ?? {};
  const after = change.after ?? {};
  const changedFields: string[] = [];
  const changedCustomFields: string[] = [];
  const storedBefore: TaskValueState = {};
  const storedAfter: TaskValueState = {};

  for (const field of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
    if (field === 'customFieldValues') continue;
    const was = before[field] ?? null;
    const is = after[field] ?? null;
    const changed =
      change.before === null ? !isEmpty(is) : change.after === null ? !isEmpty(was) : !isDeepStrictEqual(was, is);
    if (!changed) continue;
    changedFields.push(field);
    storedBefore[field] = was;
    storedAfter[field] = is;
  }
  const customBefore = (before.customFieldValues ?? {}) as Record<string, unknown>;
  const customAfter = (after.customFieldValues ?? {}) as Record<string, unknown>;
  for (const key of [...new Set([...Object.keys(customBefore), ...Object.keys(customAfter)])]) {
    if (!isDeepStrictEqual(customBefore[key] ?? null, customAfter[key] ?? null)) changedCustomFields.push(key);
  }
  changedFields.sort();
  changedCustomFields.sort();
  if (changedCustomFields.length > 0) {
    storedBefore.customFieldValues = Object.fromEntries(changedCustomFields.map((key) => [key, customBefore[key] ?? null]));
    storedAfter.customFieldValues = Object.fromEntries(changedCustomFields.map((key) => [key, customAfter[key] ?? null]));
  }
  if (changedFields.length === 0 && changedCustomFields.length === 0) return {};

  // command-coverage-ignore: runs only inside a `tasks.*` Command's `run`, on the `em`
  // the bus handed it — the row commits with that Command's one audit entry.
  const row = em.create(TaskValueChange, {
    taskId,
    before: change.before === null ? null : storedBefore,
    after: change.after === null ? null : storedAfter,
  });
  return {
    ...(changedFields.length > 0 ? { changedFields } : {}),
    ...(changedCustomFields.length > 0 ? { changedCustomFields } : {}),
    valueChangeId: row.id,
  };
}
