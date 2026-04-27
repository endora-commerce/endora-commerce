import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Organization-scoped storefront flows: members + addresses.
 * All endpoints require a customer session; member admin routes also
 * require the caller to be an Organization Admin (backend enforces 403).
 */

export interface MemberSummary {
  id: string;
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'organization_admin' | 'regular_user';
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
}

export async function listMembers(sessionCookie: string): Promise<MemberSummary[]> {
  return apiGetAuthed<MemberSummary[]>({
    path: '/api/v1/organizations/mine/members',
    sessionCookie,
  });
}

export interface PendingInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: 'organization_admin' | 'regular_user';
  invitedByCustomerAccountId: string | null;
  expiresAt: string;
  createdAt: string;
}

export async function listPendingInvitations(sessionCookie: string): Promise<PendingInvitation[]> {
  return apiGetAuthed<PendingInvitation[]>({
    path: '/api/v1/organizations/mine/invitations',
    sessionCookie,
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
  payload: { email: string; role?: 'organization_admin' | 'regular_user' },
): Promise<{ invitationId: string; expiresAt: string }> {
  const result = await apiMutate<{ invitationId: string; expiresAt: string }>({
    method: 'POST',
    path: '/api/v1/organizations/mine/invitations',
    body: payload,
    sessionCookie,
  });
  return result.data!;
}

export async function changeMemberRole(
  sessionCookie: string,
  memberId: string,
  role: 'organization_admin' | 'regular_user',
): Promise<MemberSummary> {
  const result = await apiMutate<MemberSummary>({
    method: 'PATCH',
    path: `/api/v1/organizations/mine/members/${memberId}/role`,
    body: { role },
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
