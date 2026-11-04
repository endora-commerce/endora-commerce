import type {
  CreateOrganizationRoleRequest,
  DeleteOrganizationRoleResponse,
  DeleteOrganizationRoleRequest,
  OrganizationOwnRoleResponse,
  OrganizationPermissionCatalogueResponse,
  OrganizationRoleRef,
  OrganizationRoleView,
  UpdateOrganizationRoleRequest,
} from '@endora-commerce/contracts';
import type { RequestContext } from './client';
import { StorefrontApiError } from './client';
import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Organization-scoped storefront flows: members, roles + addresses.
 * All endpoints require a customer session; member and role routes also
 * require the caller to hold the Organization's *Administrator* role (backend
 * answers 403), and the role routes answer 404 in a personal Organization
 * (`specs/170-organization-roles/contracts/storefront-api.md` §2, §3).
 *
 * Reads take the page's `ctx` so the API names roles and permissions in the
 * page's language (FR-008, R-31).
 */

export type { OrganizationRoleRef, OrganizationRoleView };

export interface MemberSummary {
  id: string;
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationRole: OrganizationRoleRef;
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
}

export async function listMembers(sessionCookie: string, ctx?: RequestContext): Promise<MemberSummary[]> {
  return apiGetAuthed<MemberSummary[]>({
    path: '/api/v1/organizations/mine/members',
    sessionCookie,
    ...(ctx ? { ctx } : {}),
  });
}

export interface PendingInvitation {
  id: string;
  organizationId: string;
  email: string;
  organizationRole: OrganizationRoleRef;
  invitedByCustomerAccountId: string | null;
  expiresAt: string;
  createdAt: string;
}

export async function listPendingInvitations(
  sessionCookie: string,
  ctx?: RequestContext,
): Promise<PendingInvitation[]> {
  return apiGetAuthed<PendingInvitation[]>({
    path: '/api/v1/organizations/mine/invitations',
    sessionCookie,
    ...(ctx ? { ctx } : {}),
  });
}

export async function revokeInvitation(
  sessionCookie: string,
  invitationId: string,
): Promise<void> {
  await apiMutate<null>({
    method: 'DELETE',
    path: `/api/v1/organizations/mine/invitations/${invitationId}`,
    sessionCookie,
  });
}

export async function inviteMember(
  sessionCookie: string,
  /** An absent `roleId` is the Organization's *Member* role, resolved by the API. */
  payload: { email: string; roleId?: string },
): Promise<{ invitationId: string; expiresAt: string }> {
  const result = await apiMutate<{ invitationId: string; expiresAt: string }>({
    method: 'POST',
    path: '/api/v1/organizations/mine/invitations',
    body: payload,
    sessionCookie,
  });
  return result.data!;
}

/**
 * Anonymous — redeem invitation from email link (`POST .../invitations/:token/accept`).
 */
export async function acceptInvitation(
  token: string,
  payload: { password: string; firstName: string; lastName: string },
): Promise<{ customerAccount: MemberSummary }> {
  const result = await apiMutate<{ customerAccount: MemberSummary }>({
    method: 'POST',
    path: `/api/v1/organizations/invitations/${encodeURIComponent(token)}/accept`,
    body: payload,
  });
  if (!result.data) {
    throw new Error('Accept invitation returned no data.');
  }
  return result.data;
}

export async function changeMemberRole(
  sessionCookie: string,
  memberId: string,
  roleId: string,
): Promise<MemberSummary> {
  const result = await apiMutate<MemberSummary>({
    method: 'PATCH',
    path: `/api/v1/organizations/mine/members/${encodeURIComponent(memberId)}/role`,
    body: { roleId },
    sessionCookie,
  });
  return result.data!;
}

export async function removeMember(sessionCookie: string, memberId: string): Promise<void> {
  await apiMutate<null>({
    method: 'DELETE',
    path: `/api/v1/organizations/mine/members/${memberId}`,
    sessionCookie,
  });
}

// --- Roles (feature 170, `contracts/storefront-api.md` §2) -----------------------

/** One module's grantable permissions, translated (R-31). */
export type PermissionCatalogueGroup = OrganizationPermissionCatalogueResponse['data']['groups'][number];

/** The member's own role and what it allows (FR-058). */
export type OwnRole = OrganizationOwnRoleResponse['data'];

export async function listRoles(sessionCookie: string, ctx?: RequestContext): Promise<OrganizationRoleView[]> {
  return apiGetAuthed<OrganizationRoleView[]>({
    path: '/api/v1/organizations/mine/roles',
    sessionCookie,
    ...(ctx ? { ctx } : {}),
  });
}

/** One role, or `null` when the Organization has none by that id (FR-005: another's reads the same). */
export async function getRole(
  sessionCookie: string,
  roleId: string,
  ctx?: RequestContext,
): Promise<OrganizationRoleView | null> {
  try {
    return await apiGetAuthed<OrganizationRoleView>({
      path: `/api/v1/organizations/mine/roles/${encodeURIComponent(roleId)}`,
      sessionCookie,
      ...(ctx ? { ctx } : {}),
    });
  } catch (err) {
    if (err instanceof StorefrontApiError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

/**
 * The permissions a role may be given: present modules' codes only, grouped by
 * module, with the label and description the API translated (FR-025). The role
 * editor lists exactly this, so a permission a module declares later appears
 * without a storefront change.
 */
export async function getPermissionCatalogue(
  sessionCookie: string,
  ctx?: RequestContext,
): Promise<PermissionCatalogueGroup[]> {
  const data = await apiGetAuthed<OrganizationPermissionCatalogueResponse['data']>({
    path: '/api/v1/organizations/mine/permission-catalogue',
    sessionCookie,
    ...(ctx ? { ctx } : {}),
  });
  return data.groups;
}

export async function createRole(
  sessionCookie: string,
  body: CreateOrganizationRoleRequest,
): Promise<OrganizationRoleView> {
  const result = await apiMutate<OrganizationRoleView>({
    method: 'POST',
    path: '/api/v1/organizations/mine/roles',
    body,
    sessionCookie,
  });
  return result.data!;
}

export async function updateRole(
  sessionCookie: string,
  roleId: string,
  body: UpdateOrganizationRoleRequest,
): Promise<OrganizationRoleView> {
  const result = await apiMutate<OrganizationRoleView>({
    method: 'PATCH',
    path: `/api/v1/organizations/mine/roles/${encodeURIComponent(roleId)}`,
    body,
    sessionCookie,
  });
  return result.data!;
}

/** Deletes a role, moving its members and pending invitations to `replacementRoleId` (FR-024). */
export async function deleteRole(
  sessionCookie: string,
  roleId: string,
  body: DeleteOrganizationRoleRequest,
): Promise<DeleteOrganizationRoleResponse['data']> {
  const result = await apiMutate<DeleteOrganizationRoleResponse['data']>({
    method: 'DELETE',
    path: `/api/v1/organizations/mine/roles/${encodeURIComponent(roleId)}`,
    body,
    sessionCookie,
  });
  return result.data ?? { reassignedMembers: 0, reassignedInvitations: 0 };
}

/** `GET …/mine/role` — any member's own role, in the page's language (FR-058). */
export async function getMyRole(sessionCookie: string, ctx?: RequestContext): Promise<OwnRole> {
  return apiGetAuthed<OwnRole>({
    path: '/api/v1/organizations/mine/role',
    sessionCookie,
    ...(ctx ? { ctx } : {}),
  });
}

export interface AddressSummary {
  id: string;
  organizationId: string;
  kind: 'delivery' | 'billing';
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

export interface AddressPayload {
  kind: 'delivery' | 'billing';
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone?: string;
  isDefault?: boolean;
}

export async function listAddresses(
  sessionCookie: string,
  kind?: 'delivery' | 'billing',
): Promise<AddressSummary[]> {
  const path = kind
    ? `/api/v1/organizations/mine/addresses?kind=${kind}`
    : '/api/v1/organizations/mine/addresses';
  return apiGetAuthed<AddressSummary[]>({ path, sessionCookie });
}

export async function createAddress(
  sessionCookie: string,
  payload: AddressPayload,
): Promise<AddressSummary> {
  const result = await apiMutate<AddressSummary>({
    method: 'POST',
    path: '/api/v1/organizations/mine/addresses',
    body: payload,
    sessionCookie,
  });
  return result.data!;
}

export async function updateAddress(
  sessionCookie: string,
  id: string,
  payload: Partial<AddressPayload>,
): Promise<AddressSummary> {
  const result = await apiMutate<AddressSummary>({
    method: 'PATCH',
    path: `/api/v1/organizations/mine/addresses/${id}`,
    body: payload,
    sessionCookie,
  });
  return result.data!;
}

export async function deleteAddress(sessionCookie: string, id: string): Promise<void> {
  await apiMutate<null>({
    method: 'DELETE',
    path: `/api/v1/organizations/mine/addresses/${id}`,
    sessionCookie,
  });
}
