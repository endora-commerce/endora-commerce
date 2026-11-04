import {
  ERROR_CODES,
  type OrganizationPermissionPort,
  type OrganizationRoleReadPort,
  type OrganizationRoleRef,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * How a member's role appears in every response this module answers
 * (`specs/170-organization-roles/` WP-03; `contracts/storefront-api.md` §1, §3;
 * `contracts/operator-api.md` §3; FR-008, FR-056, FR-073).
 *
 * The legacy `role` enum is gone from these responses; the role is
 * `organizationRole: { id, name, kind }` — a predefined role's label in the
 * response language, a custom role's own name — and a session view adds the
 * member's effective permission codes.
 */

/** The member whose role is shown: any record carrying its Organization and role id. */
export interface MemberRoleSubject {
  readonly id: string;
  readonly organizationId: string;
  readonly organizationRoleId: string;
}

/**
 * The role `organizationRoleId` of `organizationId`, as a response names it.
 *
 * Every account holds a role of its own Organization (a composite foreign key),
 * so a role the read port cannot find is a broken invariant rather than an
 * answer, and the response refuses rather than inventing a label.
 */
export async function memberRoleRef(
  roles: Pick<OrganizationRoleReadPort, 'roleRef'>,
  member: Pick<MemberRoleSubject, 'organizationId' | 'organizationRoleId'>,
  language: string | undefined,
): Promise<OrganizationRoleRef> {
  const ref = await roles.roleRef(member.organizationId, member.organizationRoleId, language);
  if (ref === null) {
    throw new HttpError(500, ERROR_CODES.INTERNAL, "The member's organization role could not be found.");
  }
  return ref;
}

/** A session view's role fields: the role and the member's effective permission codes (FR-056). */
export async function memberSessionRole(
  roles: Pick<OrganizationRoleReadPort, 'roleRef'>,
  permissions: Pick<OrganizationPermissionPort, 'effective'>,
  member: MemberRoleSubject,
  language: string | undefined,
): Promise<{ organizationRole: OrganizationRoleRef; permissions: string[] }> {
  const [organizationRole, effective] = await Promise.all([
    memberRoleRef(roles, member, language),
    permissions.effective({
      customerAccountId: member.id,
      organizationId: member.organizationId,
      organizationRoleId: member.organizationRoleId,
    }),
  ]);
  return { organizationRole, permissions: [...effective.permissions] };
}
