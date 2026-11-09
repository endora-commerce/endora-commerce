import { isReadableTreePath } from './organization-tree-service.js';

/**
 * Issue #305 — the decision half of a sales representative's reach.
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
 * `reachOf` reads the governing nodes and, under roll-up, every node below
 * one of them, in one statement; this decides each of them. A node it does
 * not name is governed by nobody and is in every representative's reach,
 * which is why the reach travels as its complement: the excluded set is
 * bounded by the B2B book, while the reachable one includes every personal
 * organization (none can be assigned, `assign()` refuses).
 *
 * Each node is decided by its **own** path — the chain `canSeeOrganization`
 * walks — so a node whose path cannot be read is decided by its own rows only,
 * exactly as the one-id rule decides it (`OrganizationTreeService.ancestorIds`
 * names no ancestor for it).
 *
 * Pure, so the decision is unit-tested apart from the SQL; the integration
 * property (`test/integration/organizations/sales-rep-reach-property.test.ts`)
 * holds it equal to `canSeeOrganization` for every node.
 */

/** An organization carrying at least one assignment row. */
export interface GoverningNode {
  readonly organizationId: string;
  /** The stored materialised path, `'/<root>/…/<id>/'`. */
  readonly path: string | null;
  /** Whether one of its rows is the representative's. */
  readonly mine: boolean;
}

/** A node under a governing node's path (roll-up only). */
export interface DescendantNode {
  readonly id: string;
  readonly path: string | null;
}

export interface SalesRepReach {
  /** Governed by somebody else: never in reach. */
  readonly excludedOrganizationIds: string[];
  /** Governed by the representative (roll-up expanded). */
  readonly assignedOrganizationIds: string[];
}

/** Ancestor-or-self ids of a node, nearest first, read off its own path. */
function chainOf(id: string, path: string | null): string[] {
  // An unreadable path names no ancestors — `OrganizationTreeService.ancestorIds`.
  if (!isReadableTreePath(path, id)) return [id];
  return path!.slice(1, -1).split('/').reverse();
}

export function decideSalesRepReach(input: {
  readonly rollup: boolean;
  readonly governors: readonly GoverningNode[];
  readonly descendants: readonly DescendantNode[];
}): SalesRepReach {
  const excluded: string[] = [];
  const assigned: string[] = [];
  if (!input.rollup) {
    for (const g of input.governors) (g.mine ? assigned : excluded).push(g.organizationId);
    return { excludedOrganizationIds: excluded, assignedOrganizationIds: assigned };
  }

  const mineByGovernor = new Map<string, boolean>();
  for (const g of input.governors) mineByGovernor.set(g.organizationId, g.mine);
  const nodes = new Map<string, string | null>();
  for (const g of input.governors) nodes.set(g.organizationId, g.path);
  for (const d of input.descendants) if (!nodes.has(d.id)) nodes.set(d.id, d.path);

  for (const [id, path] of nodes) {
    for (const link of chainOf(id, path)) {
      const mine = mineByGovernor.get(link);
      if (mine === undefined) continue;
      (mine ? assigned : excluded).push(id);
      break;
    }
  }
  return { excludedOrganizationIds: excluded, assignedOrganizationIds: assigned };
}
