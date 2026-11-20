import { recordHistoryChanges, type RecordHistoryChange } from '@endora-commerce/admin-kit/components';

/**
 * The audit log screen's pure logic (issue #1555, UX audit SHELL-20): what an
 * entry changed, field by field, and what the filters offer. Kept out of the
 * page so it is tested without rendering.
 */

/** What an entry's detail has to say about its state. */
export type AuditStateOutcome =
  /** Neither snapshot was recorded — a sign-in, an export, an erasure. */
  | { kind: 'none' }
  /** Both were, and no field differs. */
  | { kind: 'unchanged' }
  | { kind: 'changes'; changes: RecordHistoryChange[] };

function isState(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * An entry's `stateBefore` / `stateAfter` as field rows, the way a record
 * history draws them: an edit lists the fields whose value differs, before →
 * after; a creation lists the fields it arrived with; a removal lists the
 * fields it had, each struck through to nothing — a removal read as "arrived
 * with" would say the opposite of what happened. Names-only entries
 * (`specs/conventions/audit-state.md`) come through unchanged: their
 * `changedFields` is a field like any other.
 */
export function auditStateOutcome(before: unknown, after: unknown): AuditStateOutcome {
  const was = isState(before) ? before : null;
  const is = isState(after) ? after : null;
  if (!was && !is) return { kind: 'none' };
  if (was && !is) {
    const changes = recordHistoryChanges({ before: null, after: was }).map(({ field, after: value }) => ({
      field,
      before: value,
      after: null,
    }));
    return changes.length > 0 ? { kind: 'changes', changes } : { kind: 'none' };
  }
  const changes = recordHistoryChanges({ before: was, after: is });
  if (changes.length > 0) return { kind: 'changes', changes };
  return was ? { kind: 'unchanged' } : { kind: 'none' };
}

/** A filter's option: the code it sends, and what the operator reads. */
export interface AuditFilterOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * The action filter's options: each action the log holds, labelled as the
 * table labels it, with its code underneath, so typing either finds it. Sorted
 * by label. A value in the URL that the list does not hold — a deep link to an
 * action the log has not recorded yet — is kept as an option, so the filter
 * still shows what it is filtering by.
 */
export function actionFilterOptions(
  actions: ReadonlyArray<{ action: string; moduleId: string }>,
  current: string,
  label: (action: string, moduleId: string) => string,
): AuditFilterOption[] {
  const listed = current && !actions.some((a) => a.action === current) ? [...actions, { action: current, moduleId: 'core' }] : actions;
  return listed
    .map(({ action, moduleId }) => {
      const text = label(action, moduleId);
      return text === action ? { value: action, label: action } : { value: action, label: text, description: action };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The object-type filter's options, sorted; the URL's value kept, as for actions. */
export function objectTypeFilterOptions(objectTypes: readonly string[], current: string): AuditFilterOption[] {
  const listed = current && !objectTypes.includes(current) ? [...objectTypes, current] : objectTypes;
  return [...listed].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }));
}

/** The filters folded behind *More filters*, and how many of them are in use. */
export function hiddenAuditFilterCount(filters: { objectId: string; customer: string }): number {
  return (filters.objectId ? 1 : 0) + (filters.customer ? 1 : 0);
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/** Whether a stored value is an ISO timestamp, to be drawn as a date rather than a string. */
export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}
