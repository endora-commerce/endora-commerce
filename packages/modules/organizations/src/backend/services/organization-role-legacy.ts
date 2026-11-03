import type { CustomerAccountRecord } from '@endora-commerce/contracts';

/**
 * Which predefined role an account holds **before** accounts carry a role id
 * (`specs/170-organization-roles/` WP-02a; transitional).
 *
 * WP-02a delivers the roles, the port and the role routes; the account's own
 * `organization_role_id` arrives with WP-02b (migration M3). Until then the one
 * fact an account carries is its legacy `role`, and this is M3's mapping of it,
 * written once: the administrator role for `organization_admin` **or** for any
 * account of a personal Organization (owner ruling PR-3, research R-34), else
 * *Member*. Nobody can hold a custom role yet.
 *
 * It feeds the permission port's account fallback (a subject whose actor
 * carries no role id) and the roles list's member counts. **WP-02b deletes this
 * file**: the fallback then reads `organizationRoleId` off the account
 * (T046) and the counts come from the assignment itself.
 */
export function legacyPredefinedRoleKind(
  account: Pick<CustomerAccountRecord, 'role'>,
  organizationIsPersonal: boolean,
): 'administrator' | 'member' {
  return organizationIsPersonal || account.role === 'organization_admin' ? 'administrator' : 'member';
}
