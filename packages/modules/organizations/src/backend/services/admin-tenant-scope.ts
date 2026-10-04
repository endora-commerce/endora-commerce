import type {
  AdminTenantScopePort,
  PermissionReadPort,
  SalesRepAssignmentPort,
} from '@endora-commerce/contracts';

/** The role code that confines an admin to the organizations assigned to them. */
const SALES_REPRESENTATIVE_ROLE_CODE = 'sales_representative';

/**
 * The tenant reach of an authenticated admin (`adminTenantScopePort`).
 *
 * The same decision `orders`, `customers` and `quote_requests` make for their
 * own admin lists: an admin whose role is the sales-representative one reaches
 * the organizations assigned to them — subtree-expanded when they hold
 * `organizations:rollup`, which the assignment port decides — and an admin
 * holding any other role reaches every organization.
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
  salesRepScope: Pick<SalesRepAssignmentPort, 'listAssignedOrganizationIds'>,
): AdminTenantScopePort {
  return {
    resolveForAdmin: async (adminUserId) => {
      const { role, refusal } = await permissions.resolveRole(adminUserId);
      if (role === undefined) {
        return { allowAll: false, allowedOrganizationIds: [], unresolved: refusal };
      }
      if (role.code !== SALES_REPRESENTATIVE_ROLE_CODE) return { allowAll: true };
      return {
        allowAll: false,
        allowedOrganizationIds: await salesRepScope.listAssignedOrganizationIds(adminUserId),
      };
    },
  };
}
