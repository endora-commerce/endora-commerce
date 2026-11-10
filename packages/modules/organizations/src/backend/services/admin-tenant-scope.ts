import type { AdminTenantScopePort, PermissionReadPort } from '@endora-commerce/contracts';
import type { SalesRepReach } from './sales-rep-reach.js';

/** The role code that confines an admin to the organizations assigned to them. */
const SALES_REPRESENTATIVE_ROLE_CODE = 'sales_representative';

/**
 * The tenant reach of an authenticated admin (`adminTenantScopePort`).
 *
 * An admin whose role is the sales-representative one reaches every
 * organization **not governed by somebody else** — the one reach rule of
 * `canSeeOrganization` (assigned, roll-up when they hold `organizations:rollup`,
 * and the unassigned fallback), applied to every surface since issue #305 —
 * and an admin holding any other role reaches every organization.
 *
 * The reach is answered by its complement (`reach: 'excluding'`): the
 * reachable set includes every unassigned, and so every personal, organization
 * and grows with the customer base; the excluded one is bounded by the B2B
 * book. The platform turns it into `organization_id NOT IN (<the owner's SELECT>)` on the
 * row's own column.
 *
 * **An admin with no role reaches none, and is refused.** The role is where the
 * reach is read from, so an admin without one — or an id that names no live
 * administrator — has no answer here. It used to be answered with "every
 * organization", which made the absence of a role the widest role there is.
 * The scope now names no organization and carries `admin_roles`' refusal as
 * `unresolved`; the tenant guard raises it on the first tenant-scoped read, so
 * the request answers 403 `ADMIN_ROLE_REQUIRED` rather than an empty list that
 * would read as "nothing exists".
 *
 * It is carried rather than thrown because this port's caller is the
 * request-scope hook, which runs before every route: throwing here would also
 * refuse the session-only surfaces over global data — who am I, sign out — that
 * an administrator in this state still needs in order to see it and leave.
 */
export function createAdminTenantScopePort(
  permissions: Pick<PermissionReadPort, 'resolveRole'>,
  salesRepReach: {
    reachOf(adminUserId: string): Promise<SalesRepReach>;
    hasRollupCapability(adminUserId: string): Promise<boolean>;
  },
): AdminTenantScopePort {
  return {
    resolveForAdmin: async (adminUserId) => {
      const { role, refusal } = await permissions.resolveRole(adminUserId);
      if (role === undefined) {
        return { allowAll: false, allowedOrganizationIds: [], unresolved: refusal };
      }
      if (role.code !== SALES_REPRESENTATIVE_ROLE_CODE) return { allowAll: true };
      // A question that cannot be answered is refused, never widened (ruling
      // Q1 on PR #954): the scope holds no organization and carries the error,
      // which the tenant guard raises on the first tenant-scoped read — as for
      // a missing role, so the session-only routes keep answering.
      let rollup: boolean;
      try {
        rollup = await salesRepReach.hasRollupCapability(adminUserId);
      } catch (error) {
        return {
          allowAll: false,
          allowedOrganizationIds: [],
          unresolved: error instanceof Error ? error : new Error(String(error)),
        };
      }
      // Issue #955 Phase 2 (owner ruling of 2026-11-10) — the reach is not
      // computed here, on every admin request: the filter renders the query,
      // and the lists load on demand, once for this scope. A failure of that
      // load rejects every helper that awaits it, so it refuses too.
      let pending: Promise<{ excludedOrganizationIds: string[]; assignedOrganizationIds: string[] }> | undefined;
      const loadReach = () =>
        (pending ??= salesRepReach.reachOf(adminUserId).then((reach) => ({
          excludedOrganizationIds: reach.excludedOrganizationIds,
          assignedOrganizationIds: reach.assignedOrganizationIds,
        })));
      return {
        allowAll: false,
        reach: 'excluding',
        excludedOrganizationsQuery: reachExcludedQuery(adminUserId, rollup),
        loadReach,
      };
    },
  };
}

/**
 * Issue #955 (architect ruling, Q2) — the excluded organizations of one
 * representative as the uncorrelated SELECT the tenant filter renders on the
 * row's own column (`col is not null and col not in (<sql>)`). It reads
 * `organizations_reach_excluded`, the same function `reachOf`'s excluded half
 * reads, live in each statement's snapshot — so no cache, and no list to ship.
 * Built from the authenticated admin's id and their roll-up permission only,
 * never from request input. This file is its only producer (a static pin holds
 * that); the platform never names the function.
 */
export function reachExcludedQuery(
  adminUserId: string,
  rollup: boolean,
): { readonly sql: string; readonly params: readonly (string | boolean)[] } {
  return {
    sql: 'select x from "organizations_reach_excluded"(?::uuid, ?::boolean) as x',
    params: [adminUserId, rollup],
  };
}
