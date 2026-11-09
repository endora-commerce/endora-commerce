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
 * book. The platform turns it into `organization_id NOT IN (excluded)` on the
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
  salesRepReach: { reachOf(adminUserId: string): Promise<SalesRepReach> },
): AdminTenantScopePort {
  return {
    resolveForAdmin: async (adminUserId) => {
      const { role, refusal } = await permissions.resolveRole(adminUserId);
      if (role === undefined) {
        return { allowAll: false, allowedOrganizationIds: [], unresolved: refusal };
      }
      if (role.code !== SALES_REPRESENTATIVE_ROLE_CODE) return { allowAll: true };
      // A reach that cannot be computed is refused, never widened (ruling Q1 on
      // PR #954): the scope holds no organization and carries the error, which
      // the tenant guard raises on the first tenant-scoped read — as for a
      // missing role, so the session-only routes keep answering.
      let reach: SalesRepReach;
      try {
        reach = await salesRepReach.reachOf(adminUserId);
      } catch (error) {
        return {
          allowAll: false,
          allowedOrganizationIds: [],
          unresolved: error instanceof Error ? error : new Error(String(error)),
        };
      }
      return {
        allowAll: false,
        reach: 'excluding',
        excludedOrganizationIds: reach.excludedOrganizationIds,
        assignedOrganizationIds: reach.assignedOrganizationIds,
      };
    },
  };
}
