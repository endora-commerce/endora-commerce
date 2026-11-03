/**
 * The storefront's one reading of a member's organization role
 * (`specs/170-organization-roles/`, research R-12, R-35).
 *
 * Every page and component that shows or hides a buyer action asks `can`, and
 * every organization-management surface asks `isAdministrator` — never the
 * session fields directly, so the rule has one spelling. Both are presentation
 * only: the backend's guards are the boundary, and a hidden button the server
 * would still refuse is the correct failure mode.
 *
 * The session is **structural**: the account pages and the commerce surfaces
 * read different fetchers, and any shape carrying `permissions` and
 * `organizationRole` will do. A signed-out visitor, or a backend that answers
 * neither field, can nothing and is no administrator. A signed-out visitor's
 * guest basket is not judged by this helper at all (owner ruling PR-4): the
 * caller offers add-to-cart to a visitor and asks `can(session, 'carts.create')`
 * of a signed-in member only.
 */

/** The fields these helpers read; every other field of a session is ignored. */
export interface OrganizationPermissionSession {
  readonly permissions?: readonly string[] | null;
  readonly organizationRole?: { readonly kind: string } | null;
}

/** Whether the session's role holds `code` — an exact match, never a prefix. */
export function can(session: OrganizationPermissionSession | null | undefined, code: string): boolean {
  return session?.permissions?.includes(code) ?? false;
}

/**
 * Whether the session holds its Organization's *Administrator* role — the
 * reserved capabilities (members, invitations, roles, MFA policy, FR-010 to
 * FR-012) follow the role **kind**, never the permission list: a custom role
 * holding every code is still not the administrator.
 */
export function isAdministrator(session: OrganizationPermissionSession | null | undefined): boolean {
  return session?.organizationRole?.kind === 'administrator';
}
