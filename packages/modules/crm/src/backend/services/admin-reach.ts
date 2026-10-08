import type { AdminTenantScopePort } from '@endora-commerce/contracts';

/** Whether an administrator's requests may reach an Organization. */
export type AdminReach = (adminUserId: string, organizationId: string) => Promise<boolean>;

/**
 * The reach of an administrator **other than the one behind the request**
 * (`specs/143-crm-sales-opportunities/research.md` N-R2).
 *
 * The tenant scope answers for the caller. Two things CRM does concern
 * somebody else — making them the assignee, and writing into their bell — and
 * for those the question is put to `organizations`' `adminTenantScopePort`,
 * the port the request-scope hook itself establishes a caller's reach from, so
 * the two cannot disagree about one administrator. An administrator whose
 * reach could not be established reaches nothing.
 *
 * A function rather than a literal at the composition site, as the notifier is
 * and for its reason: `check:port-catches` follows the port through the value.
 * Nothing here catches anything.
 */
export function createAdminReach(scopes: AdminTenantScopePort): AdminReach {
  return async (adminUserId, organizationId) => {
    const scope = await scopes.resolveForAdmin(adminUserId);
    return scope.allowAll || scope.allowedOrganizationIds.includes(organizationId);
  };
}
