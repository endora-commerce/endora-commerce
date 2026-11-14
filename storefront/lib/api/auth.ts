import type { CartMergeOutcomePublic } from '@endora-commerce/contracts';
import { apiMutate } from './mutations';
import type { RequestContext } from './client';
import { knownDeviceCookieHeader, rememberKnownDevice, signInCookieHeader } from '../session';

/**
 * Anonymous storefront auth flows (register / verify / login / logout /
 * password reset). These wrap the backend's `/api/v1/auth/**` and
 * `/api/v1/organizations/register` endpoints with typed payloads.
 *
 * The sign-in, the second step and the reset request carry the browser's
 * known-device cookie to the backend, and the first two store the one the
 * backend sets on a completed sign-in (see `knownDeviceCookieHeader` in
 * `lib/session.ts`). Without it every shopper's attempt would be counted as
 * one from a device the account has never been used on. The sign-in and the
 * second step also carry the signed-out basket's cookie and the signed-out
 * comparison's (`signInCookieHeader`), so the backend can carry both over to
 * the customer on whichever call establishes the session (issues #358, #368,
 * #1189).
 */

export interface RegisterOrganizationPayload {
  organization: {
    name: string;
    taxId: string;
    registeredAddress: { street: string; city: string; postalCode: string; country: string };
    vatStatus?: 'vat_payer' | 'vat_exempt' | 'flat_rate';
    /** Feature 175 — the Organization's custom fields open on `organization.register`. */
    customFieldValues?: Record<string, unknown>;
  };
  firstUser: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    /** Feature 175 — the account owner's custom fields open on `organization.register`. */
    customFieldValues?: Record<string, unknown>;
  };
  acceptedTermsVersion: string;
  /**
   * Feature 173 — the reference a registry lookup answered. The backend reads
   * the snapshot from its own store by this id; nothing else about the lookup
   * is sent back.
   */
  registryLookupId?: string;
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
}

interface LoginCustomerResponseData {
  /** Feature 042 — two-step login discriminator. */
  status: 'authenticated' | 'mfaRequired' | 'mfaSetupRequired';
  challengeId?: string;
  setupTicket?: string;
  customerAccount?: {
    id: string;
    email: string;
    organizationId: string;
    role: string;
    twoFactorEnabled: boolean;
  };
  /**
   * Result of the anonymous-cart → customer-cart merge that ran inside
   * this login (feature 037-cart-merge-on-login). `null` / absent when
   * the request carried no `b2b_cart_anon` cookie; `outcome: 'noop'`
   * when the cookie was supplied but had no observable effect.
   */
  cartMerge?: CartMergeOutcomePublic | null;
}

export type LoginCustomerResult =
  | {
      status: 'authenticated';
      sessionCookieValue: string | null;
      cartMerge: CartMergeOutcomePublic | null;
    }
  | { status: 'mfaRequired'; challengeId: string }
  | { status: 'mfaSetupRequired'; setupTicket: string };

export async function loginCustomer(
  payload: LoginCustomerPayload,
  ctx?: RequestContext,
): Promise<LoginCustomerResult> {
  const result = await apiMutate<LoginCustomerResponseData>({
    method: 'POST',
    path: '/api/v1/auth/customer/login',
    body: payload,
    // The known-device cookie and the signed-out basket, which the backend
    // merges into the customer's at sign-in (issue #358).
    rawCookieHeader: await signInCookieHeader(),
    ...(ctx ? { ctx } : {}),
  });
  await rememberKnownDevice(result.setCookie);
  const data = result.data!;
  if (data.status === 'mfaRequired') {
    return { status: 'mfaRequired', challengeId: data.challengeId! };
  }
  if (data.status === 'mfaSetupRequired') {
    return { status: 'mfaSetupRequired', setupTicket: data.setupTicket! };
  }
  // The session cookie comes back in Set-Cookie; persisted via setSessionCookie.
  return {
    status: 'authenticated',
    sessionCookieValue: pickSessionCookie(result.setCookie),
    cartMerge: data.cartMerge ?? null,
  };
}

/**
 * Feature 042 — complete the second step; returns the new session cookie.
 *
 * Issue #368 — this call, not the password one, establishes the session of an
 * account with two-step verification, so it carries the signed-out basket's
 * cookie as well and returns the merge the backend ran.
 */
export async function verifyCustomerMfa(
  payload: { challengeId: string; code: string },
  ctx?: RequestContext,
): Promise<{ sessionCookieValue: string | null; cartMerge: CartMergeOutcomePublic | null }> {
  const result = await apiMutate<{ status: 'authenticated'; cartMerge?: CartMergeOutcomePublic | null }>({
    method: 'POST',
    path: '/api/v1/auth/customer/mfa/verify',
    body: payload,
    rawCookieHeader: await signInCookieHeader(),
    ...(ctx ? { ctx } : {}),
  });
  await rememberKnownDevice(result.setCookie);
  return {
    sessionCookieValue: pickSessionCookie(result.setCookie),
    cartMerge: result.data?.cartMerge ?? null,
  };
}

export interface RegisterStandaloneCustomerPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  acceptedTermsVersion: string;
}

export interface RegisterStandaloneCustomerResult {
  customerAccount: { id: string; email: string; organizationId: string | null };
  /** Auto-login session cookie value (the backend logs the new account straight in). */
  sessionCookieValue: string | null;
}

/**
 * Feature 040 — standalone (org-less) customer registration. Gated server-side
 * by the `customers.allow_registration_without_organization` setting; the
 * backend returns 403 REGISTRATION_REQUIRES_ORGANIZATION when disabled.
 */
export async function registerStandaloneCustomer(
  payload: RegisterStandaloneCustomerPayload,
  ctx?: RequestContext,
): Promise<RegisterStandaloneCustomerResult> {
  const result = await apiMutate<{
    customerAccount: { id: string; email: string; organizationId: string | null };
  }>({
    method: 'POST',
    path: '/api/v1/customers/register',
    body: payload,
    ...(ctx ? { ctx } : {}),
  });
  return {
    customerAccount: result.data!.customerAccount,
    sessionCookieValue: pickSessionCookie(result.setCookie),
  };
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
    rawCookieHeader: await knownDeviceCookieHeader(),
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
