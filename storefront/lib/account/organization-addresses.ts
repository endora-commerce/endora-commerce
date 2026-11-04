import { can, type OrganizationPermissionSession } from '../organization-permissions';

/** The permission adding or removing an Organization address needs (`organizations` manifest, OR-8). */
const ADDRESSES_MANAGE = 'addresses.manage';

/**
 * Whether `/organization/addresses` offers its add form and *Remove* buttons
 * (`specs/170-organization-roles/` WP-16; FR-057, OR-8; owner ruling of 2026-11-04: a member who
 * cannot act is not shown the controls). Reading the list stays open to every member.
 *
 * `null` is a session `/api/v1/me` did not answer for: today's page, the server being the gate
 * (`contracts/storefront-api.md` §4).
 */
export function mayManageOrganizationAddresses(session: OrganizationPermissionSession | null | undefined): boolean {
  if (!session) return true;
  return can(session, ADDRESSES_MANAGE);
}
