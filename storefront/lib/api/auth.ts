import { apiMutate } from './mutations';
import type { RequestContext } from './client';

/**
 * Anonymous storefront auth flows (register / verify / login / logout /
 * password reset). These wrap the backend's `/api/v1/auth/**` and
 * `/api/v1/organizations/register` endpoints with typed payloads.
 */

export interface RegisterOrganizationPayload {
  organization: {
    name: string;
    taxId: string;
    registeredAddress: { street: string; city: string; postalCode: string; country: string };
    vatStatus?: 'vat_payer' | 'vat_exempt' | 'flat_rate';
  };
  firstUser: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  };
  acceptedTermsVersion: string;
}

export interface RegisterOrganizationResult {
  organization: { id: string; name: string };
  customerAccount: { id: string; email: string; emailVerifiedAt: string | null };
  emailVerificationSent: boolean;
}

export async function registerOrganization(
  payload: RegisterOrganizationPayload,
  ctx?: RequestContext,
): Promise<RegisterOrganizationResult> {
  const result = await apiMutate<RegisterOrganizationResult>({
    method: 'POST',
    path: '/api/v1/organizations/register',
    body: payload,
    ...(ctx ? { ctx } : {}),
  });
  return result.data!;
}

export async function verifyEmail(
  token: string,
  ctx?: RequestContext,
): Promise<{ verifiedAt: string; customerAccountId: string }> {
  const result = await apiMutate<{ verifiedAt: string; customerAccountId: string }>({
    method: 'POST',
    path: '/api/v1/auth/email-verification/verify',
    body: { token },
    ...(ctx ? { ctx } : {}),
  });
  return result.data!;
}

export interface LoginCustomerPayload {
  email: string;
  password: string;
  twoFactorCode?: string;
}

export interface LoginCustomerResult {
  customerAccount: {
    id: string;
    email: string;
    organizationId: string;
    role: string;
    twoFactorEnabled: boolean;
  };
  /** Raw `b2b_session` cookie value the storefront should persist. */
  sessionCookieValue: string | null;
}

export async function loginCustomer(
  payload: LoginCustomerPayload,
  ctx?: RequestContext,
): Promise<LoginCustomerResult> {
  const result = await apiMutate<LoginCustomerResult['customerAccount']>({
    method: 'POST',
    path: '/api/v1/auth/customer/login',
    body: payload,
    ...(ctx ? { ctx } : {}),
  });
  // The session cookie comes back in Set-Cookie; the storefront persists it via setSessionCookie.
  const cookieValue = pickSessionCookie(result.setCookie);
  return { customerAccount: result.data!, sessionCookieValue: cookieValue };
}

export async function logoutCustomer(sessionCookie: string | null): Promise<void> {
  if (!sessionCookie) return;
  await apiMutate<null>({
    method: 'POST',
    path: '/api/v1/auth/customer/logout',
    sessionCookie,
  });
}

export async function requestPasswordReset(email: string, ctx?: RequestContext): Promise<void> {
  await apiMutate<null>({
    method: 'POST',
    path: '/api/v1/auth/password-reset/request',
    body: { email },
    ...(ctx ? { ctx } : {}),
  });
}

export async function confirmPasswordReset(
  token: string,
  newPassword: string,
  ctx?: RequestContext,
): Promise<void> {
  await apiMutate<{ ok: true }>({
    method: 'POST',
    path: '/api/v1/auth/password-reset/confirm',
    body: { token, newPassword },
    ...(ctx ? { ctx } : {}),
  });
}

function pickSessionCookie(setCookie: string[]): string | null {
  for (const header of setCookie) {
    const match = /(?:^|;\s*)?b2b_session=([^;]+)/.exec(header);
    if (match) return match[1] ?? null;
  }
  return null;
}
