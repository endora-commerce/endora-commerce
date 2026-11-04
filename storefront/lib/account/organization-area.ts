import { can, isAdministrator, type OrganizationPermissionSession } from '../organization-permissions';

/**
 * Who is offered the organization-management screens
 * (`specs/170-organization-roles/`, FR-057, FR-070a; research R-34). The
 * account navigation and each page ask this one function, so a link is shown
 * exactly where its page would render.
 *
 * - *Members* and *Roles* are the administrator's (reserved capabilities,
 *   FR-010); *Carts to approve* follows `carts.approve` (FR-033).
 * - A personal (B2C) Organization is offered none of them, although its one
 *   member holds *Administrator* (owner rulings PR-3, PR-10): the gate is the
 *   Organization's **kind**, never the role, and its pages send that member
 *   back to `/account` as they do an org-less customer.
 *
 * Presentation only — the API's guards are the boundary.
 */

export type OrganizationArea = 'members' | 'roles' | 'carts';

/**
 * `absent` — the screen does not exist for this customer (no Organization, or
 * a personal one): the page redirects to `/account`. `refused` — a company
 * Organization's member who may not use it: the page says so. `allowed`.
 */
export type OrganizationAreaAccess = 'absent' | 'refused' | 'allowed';

export interface OrganizationAreaSession {
  readonly customerAccount: OrganizationPermissionSession;
  readonly organization: { readonly isPersonal?: boolean } | null;
}

/** The permission the carts area is opened by (`carts` manifest, FR-022). */
const CARTS_APPROVE = 'carts.approve';

export function organizationAreaAccess(me: OrganizationAreaSession, area: OrganizationArea): OrganizationAreaAccess {
  if (!me.organization || me.organization.isPersonal === true) return 'absent';
  const allowed = area === 'carts' ? can(me.customerAccount, CARTS_APPROVE) : isAdministrator(me.customerAccount);
  return allowed ? 'allowed' : 'refused';
}
