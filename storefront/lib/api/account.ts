import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Authenticated storefront account flows. Every call requires an active
 * `b2b_session` cookie which is forwarded to the backend.
 */

export interface CurrentCustomer {
  id: string;
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'organization_admin' | 'regular_user';
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
}

export interface CurrentOrganization {
  id: string;
  name: string;
  taxId: string;
  status: string;
  vatStatus: string;
  registeredAddress: { street: string; city: string; postalCode: string; country: string };
}

export interface MeResult {
  customerAccount: CurrentCustomer;
  organization: CurrentOrganization;
  /** Non-null when the current session is an Admin impersonating this customer. */
  impersonation: { impersonatorAdminUserId: string } | null;
}

export async function getMe(sessionCookie: string): Promise<MeResult> {
  return apiGetAuthed<MeResult>({ path: '/api/v1/me', sessionCookie });
}

export async function changePassword(
  sessionCookie: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiMutate<null>({
    method: 'POST',
    path: '/api/v1/me/password',
    body: { currentPassword, newPassword },
    sessionCookie,
  });
}

export interface TwoFactorEnrolment {
  secret: string;
  otpauthUri: string;
  backupCodes: string[];
}

export async function enableTwoFactor(sessionCookie: string): Promise<TwoFactorEnrolment> {
  const result = await apiMutate<TwoFactorEnrolment>({
    method: 'POST',
    path: '/api/v1/me/two-factor/enable',
    sessionCookie,
  });
  return result.data!;
}

export async function confirmTwoFactor(sessionCookie: string, code: string): Promise<void> {
  await apiMutate<null>({
    method: 'POST',
    path: '/api/v1/me/two-factor/confirm',
    body: { code },
    sessionCookie,
  });
}

export async function disableTwoFactor(sessionCookie: string, code: string): Promise<void> {
  await apiMutate<null>({
    method: 'POST',
    path: '/api/v1/me/two-factor/disable',
    body: { code },
    sessionCookie,
  });
}
