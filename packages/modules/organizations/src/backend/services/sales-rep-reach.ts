/**
 * Issue #305 — a sales representative's reach, as the tenant scope carries it.
 *
 * The rule is `SalesRepAssignmentService.canSeeOrganization`'s, stated once:
 * a representative R sees Organization X when X is **not governed by somebody
 * else**.
 *
 *  - flat: X is governed by its own assignment rows; R sees X when it has none
 *    or one of them is R's;
 *  - roll-up: X is governed by the nearest ancestor-or-self carrying any
 *    assignment row; R sees X when there is no such node or that node has a
 *    row for R (FR-011 override).
 *
 * The reach travels as its complement: the excluded set is bounded by the B2B
 * book, while the reachable one includes every personal organization (none can
 * be assigned, `assign()` refuses). An organization in neither list is
 * governed by nobody and is in every representative's reach.
 *
 * Since issue #955 the decision is made in SQL: flat over the assignment table,
 * roll-up over the materialised `organization_reach_governor` table, whose
 * rows are each organization's nearest governing node read off its **own**
 * path — the chain `canSeeOrganization` walks. The statement answers both
 * lists as one comma-separated aggregate each (one row, not one row per id);
 * {@link reachFromAggregate} reads them back. The integration property
 * (`test/integration/organizations/sales-rep-reach-property.test.ts`) holds the
 * answer equal to `canSeeOrganization` for every node, after every kind of
 * write.
 */
export interface SalesRepReach {
  /** Governed by somebody else: never in reach. */
  readonly excludedOrganizationIds: string[];
  /** Governed by the representative (roll-up expanded). */
  readonly assignedOrganizationIds: string[];
  /**
   * Whether the reach was answered under roll-up (`organizations:rollup`). The
   * tenant scope passes it to `organizations_reach_excluded`, so the filter's
   * subquery answers the same question this did (issue #955).
   */
  readonly rollup: boolean;
}

/** The reach statement's one row: each list as `string_agg(id, ',')`, `null` when empty. */
export interface ReachAggregateRow {
  readonly excluded: string | null;
  readonly assigned: string | null;
}

/** Reads the reach statement's row back into the two id lists. */
export function reachFromAggregate(row: ReachAggregateRow | undefined, rollup: boolean): SalesRepReach {
  return {
    excludedOrganizationIds: splitIds(row?.excluded),
    assignedOrganizationIds: splitIds(row?.assigned),
    rollup,
  };
}

function splitIds(joined: string | null | undefined): string[] {
  return joined ? joined.split(',') : [];
}
