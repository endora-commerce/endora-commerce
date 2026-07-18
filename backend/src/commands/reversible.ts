import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Reversible-operation contract (feature 054, US2 — bulk-edit undo).
 *
 * A reversible command captures, per affected record, the minimal changed-field
 * before-values plus the after-values it wrote (research §R3/§R5). Undo restores
 * `before` for every record whose current state still matches `after` (unchanged
 * since the operation), and refuses records that changed — all-or-nothing per
 * record, with a conflict report (FR-006). The stored `RevertRecord[]` is the
 * `revert_state` persisted on the operation row.
 */

/** One affected record's captured pre/post state, sufficient to detect conflicts and restore. */
export interface RevertRecord {
  /** Id of the affected record. */
  readonly recordId: string;
  /** Minimal changed-field values before the operation (what undo restores). */
  readonly before: Record<string, unknown>;
  /** The values the operation wrote (compared against current state to detect conflicts). */
  readonly after: Record<string, unknown>;
}

/** Terminal-ish undo state of a reversible operation (FR-014 idempotent re-invoke). */
export type UndoStatus = 'none' | 'reverted' | 'partially_reverted';

/** Why a record could not be reverted. */
export type RevertConflictReason = 'changed_since_operation' | 'missing';

/** A record the undo refused to touch, with the reason. */
export interface RevertConflict {
  readonly recordId: string;
  readonly reason: RevertConflictReason;
}

/** Outcome of running an undo over a set of {@link RevertRecord}s. */
export interface UndoResult {
  /** Ids restored to their `before` state. */
  readonly reverted: string[];
  /** Records refused (changed since / missing), never overwritten. */
  readonly conflicts: RevertConflict[];
  /** The resulting operation undo status. */
  readonly undoStatus: UndoStatus;
}

/**
 * The per-record hooks a module supplies to make its records revertible. The
 * generic {@link applyUndo} helper drives them: it reads current state, compares
 * to `after`, and either restores `before` or records a conflict.
 */
export interface RevertHandlers {
  /**
   * Current changed-field values for a record, keyed like `RevertRecord.after`.
   * Return `null` if the record no longer exists.
   */
  readCurrent(em: EntityManager, rec: RevertRecord): Promise<Record<string, unknown> | null>;
  /** Restore a single record's `before` values on the transactional em. */
  restore(em: EntityManager, rec: RevertRecord): Promise<void>;
  /** Whether the record already carries its `before` state (already reverted → skip, no conflict). */
  matchesBefore?(current: Record<string, unknown>, rec: RevertRecord): boolean;
  /** Field-equality predicate; defaults to shallow JSON equality. */
  equals?(a: Record<string, unknown>, b: Record<string, unknown>): boolean;
}

/** Shallow, order-insensitive JSON equality over the keys present in `expected`. */
export function shallowFieldEquals(
  current: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  for (const key of Object.keys(expected)) {
    if (JSON.stringify(current[key]) !== JSON.stringify(expected[key])) return false;
  }
  return true;
}

/**
 * Restore every record whose current state still matches its captured `after`;
 * refuse the rest. All-or-nothing per record (FR-006). Idempotent-safe: a record
 * already at its `before` state (matchesBefore) is counted as reverted without a
 * second write. The caller persists the returned `undoStatus` on the operation row.
 */
export async function applyUndo(
  em: EntityManager,
  records: readonly RevertRecord[],
  handlers: RevertHandlers,
): Promise<UndoResult> {
  const equals = handlers.equals ?? shallowFieldEquals;
  const reverted: string[] = [];
  const conflicts: RevertConflict[] = [];

  for (const rec of records) {
    const current = await handlers.readCurrent(em, rec);
    if (current === null) {
      conflicts.push({ recordId: rec.recordId, reason: 'missing' });
      continue;
    }
    // Already restored (e.g. a prior partial undo) — count as reverted, no rewrite.
    if (handlers.matchesBefore?.(current, rec) ?? equals(current, rec.before)) {
      reverted.push(rec.recordId);
      continue;
    }
    // Changed since the operation → refuse, never clobber.
    if (!equals(current, rec.after)) {
      conflicts.push({ recordId: rec.recordId, reason: 'changed_since_operation' });
      continue;
    }
    await handlers.restore(em, rec);
    reverted.push(rec.recordId);
  }

  const undoStatus: UndoStatus =
    conflicts.length === 0 ? 'reverted' : reverted.length === 0 ? 'none' : 'partially_reverted';
  return { reverted, conflicts, undoStatus };
}
