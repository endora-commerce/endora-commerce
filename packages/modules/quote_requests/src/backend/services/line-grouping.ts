import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Feature 159 — the plan of a grouping write (research R-8, R-14,
 * `specs/159-quote-request-item-groups/contracts/quote-requests-api.md` §1).
 *
 * Pure: it reads the stored groups, the request body and the stored row each
 * body line was paired with (`pairLines`), and answers what to do — which
 * groups to keep, update, create or delete, and each body line's group and its
 * position within its section. `RfqAdminService` (`modify`, `createOnBehalf`)
 * and `RfqService.patchDraft` write the plan inside their row lock.
 *
 * - A body **with** `groups` replaces the grouping: a group with an `id` keeps
 *   its identity (renamed, repositioned), one without is created, a stored
 *   group the body does not name is deleted. Lines take their `groupKey`'s
 *   group.
 * - A body **without** `groups` keeps it: a paired line keeps its stored group,
 *   a new line is ungrouped, no group changes (an API client unaware of groups
 *   must not ungroup a quote it touches).
 *
 * Positions are always rewritten as a set: groups 0…g-1 in body order, each
 * section's lines 0…k-1 in body order (invariant I-Q2).
 */

export interface StoredLineGroup {
  readonly id: string;
  readonly name: string;
  readonly position: number;
}

export interface LineGroupingBody {
  readonly groups?: readonly { readonly key: string; readonly id?: string | undefined; readonly name: string }[] | undefined;
  readonly items: readonly { readonly groupKey?: string | null | undefined }[];
}

export type PlannedGroup =
  | { kind: 'keep'; id: string; name: string; position: number }
  | { kind: 'update'; id: string; key: string; name: string; position: number }
  | { kind: 'create'; key: string; name: string; position: number };

/** A line's group: a stored one by id, one the plan creates by key, or none. */
export type PlannedLineGroup = { kind: 'existing'; id: string } | { kind: 'new'; key: string } | null;

export interface PlannedLine {
  readonly group: PlannedLineGroup;
  readonly position: number;
}

/** The grouping's shape as the audit entry records it (FR-081). */
/**
 * One group of an audit entry's `groups`: its line count, in display order.
 * Never its name — a group name is free text, and the audit log carries no
 * tenant value (D-288, issue #470); the revisions keep the names.
 */
export interface GroupingShapeEntry {
  readonly lineCount: number;
}

export interface LineGroupingPlan {
  /** Every resulting group, in order. */
  readonly groups: PlannedGroup[];
  readonly deleteGroupIds: string[];
  /** Index-aligned with `body.items`. */
  readonly lines: PlannedLine[];
  /** The resulting shape, for the audit entry's `stateAfter.groups`. */
  readonly after: GroupingShapeEntry[];
}

export function planLineGrouping(input: {
  readonly storedGroups: readonly StoredLineGroup[];
  readonly body: LineGroupingBody;
  /** Index-aligned with `body.items`: the stored row each line is, or `null` for a new line. */
  readonly pairedRows: readonly ({ readonly groupId?: string | null | undefined } | null)[];
}): LineGroupingPlan {
  const { storedGroups, body, pairedRows } = input;
  const storedIds = new Set(storedGroups.map((group) => group.id));
  const sortedStored = [...storedGroups].sort((a, b) => a.position - b.position);

  let groups: PlannedGroup[];
  let deleteGroupIds: string[];
  let groupOf: (index: number) => PlannedLineGroup;

  if (body.groups !== undefined) {
    const foreign = body.groups.flatMap((group, index) =>
      group.id !== undefined && !storedIds.has(group.id)
        ? [{ path: `groups.${index}.id`, issue: 'Not a group of this quote request.' }]
        : [],
    );
    if (foreign.length > 0) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A group does not belong to this quote request.', foreign);
    }
    groups = body.groups.map((group, position): PlannedGroup =>
      group.id !== undefined
        ? { kind: 'update', id: group.id, key: group.key, name: group.name, position }
        : { kind: 'create', key: group.key, name: group.name, position },
    );
    const named = new Set(body.groups.flatMap((group) => (group.id !== undefined ? [group.id] : [])));
    deleteGroupIds = sortedStored.filter((group) => !named.has(group.id)).map((group) => group.id);
    const byKey = new Map(body.groups.map((group) => [group.key, group]));
    groupOf = (index) => {
      const key = body.items[index]?.groupKey;
      const group = key ? byKey.get(key) : undefined;
      if (!group) return null;
      return group.id !== undefined ? { kind: 'existing', id: group.id } : { kind: 'new', key: group.key };
    };
  } else {
    groups = sortedStored.map((group, position) => ({ kind: 'keep', id: group.id, name: group.name, position }));
    deleteGroupIds = [];
    groupOf = (index) => {
      const groupId = pairedRows[index]?.groupId ?? null;
      return groupId !== null && storedIds.has(groupId) ? { kind: 'existing', id: groupId } : null;
    };
  }

  const nextPosition = new Map<string, number>();
  const lines = body.items.map((_, index): PlannedLine => {
    const group = groupOf(index);
    const section = group === null ? '' : group.kind === 'existing' ? `id:${group.id}` : `key:${group.key}`;
    const position = nextPosition.get(section) ?? 0;
    nextPosition.set(section, position + 1);
    return { group, position };
  });

  const after = groups.map((group) => ({
    lineCount: nextPosition.get(group.kind === 'create' ? `key:${group.key}` : `id:${group.id}`) ?? 0,
  }));
  return { groups, deleteGroupIds, lines, after };
}

/** The stored grouping's shape — `stateBefore.groups` of an audit entry. */
export function groupingShape(
  storedGroups: readonly StoredLineGroup[],
  lineGroupIds: readonly (string | null | undefined)[],
): GroupingShapeEntry[] {
  return [...storedGroups]
    .sort((a, b) => a.position - b.position)
    .map((group) => ({ lineCount: lineGroupIds.filter((id) => id === group.id).length }));
}
