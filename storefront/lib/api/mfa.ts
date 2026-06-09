import { apiMutate, apiGetAuthed } from './mutations';
import type { RequestContext } from './client';

function pickSessionCookie(setCookie: string[]): string | null {
  for (const header of setCookie) {
    const match = /(?:^|;\s*)?b2b_session=([^;]+)/.exec(header);
    if (match) return match[1] ?? null;
  }
  return null;
}

/**
 * Feature 042 US3 — enforced-but-unenrolled setup-ticket flow. `begin` returns
 * the secret for the forced-setup screen; `complete` activates and returns a
 * session cookie.
 */
export async function beginMfaSetupTicket(
  setupTicket: string,
  ctx?: RequestContext,
): Promise<{ secret: string; otpauthUri: string }> {
  const res = await apiMutate<{ secret: string; otpauthUri: string }>({
    method: 'POST',
    path: '/api/v1/auth/customer/mfa/setup-ticket/begin',
    body: { setupTicket },
    ...(ctx ? { ctx } : {}),
  });
  return res.data!;
}

export async function completeMfaSetupTicket(
  setupTicket: string,
  code: string,
  ctx?: RequestContext,
): Promise<{ recoveryCodes: string[]; sessionCookieValue: string | null }> {
  const res = await apiMutate<{ status: 'authenticated'; recoveryCodes: string[] }>({
    method: 'POST',
    path: '/api/v1/auth/customer/mfa/setup-ticket/complete',
    body: { setupTicket, code },
    ...(ctx ? { ctx } : {}),
  });
  return {
    recoveryCodes: res.data!.recoveryCodes,
    sessionCookieValue: pickSessionCookie(res.setCookie),
  };
}

/** Feature 042 US3 — org-admin sets per-organization 2FA enforcement. */
export async function setOrganizationMfaPolicy(
  sessionCookie: string,
  enforceTotp: boolean,
): Promise<{ enforceTotp: boolean }> {
  const res = await apiMutate<{ enforceTotp: boolean }>({
    method: 'PUT',
    path: '/api/v1/account/organization/mfa-policy',
    body: { enforceTotp },
    sessionCookie,
  });
  return res.data!;
}

/**
 * Storefront self-service 2FA wrappers (feature 042, US1). All calls are made
 * with the customer's `b2b_session` cookie (server-side; the cookie is
 * httpOnly).
 */

export interface MfaStatus {
  totpActive: boolean;
  recoveryCodesRemaining: number;
  totpEnabledForScope: boolean;
  totpEnforcedForScope: boolean;
  socialLinks: Array<{ provider: string; email: string; linkedAt: string }>;
}

export async function getMfaStatus(
  sessionCookie: string,
  ctx?: RequestContext,
): Promise<MfaStatus> {
  return apiGetAuthed<MfaStatus>({
    path: '/api/v1/account/mfa/status',
    sessionCookie,
    ...(ctx ? { ctx } : {}),
  });
}

export async function startMfaSetup(
  sessionCookie: string,
): Promise<{ secret: string; otpauthUri: string }> {
  const res = await apiMutate<{ secret: string; otpauthUri: string }>({
    method: 'POST',
    path: '/api/v1/account/mfa/setup',
    sessionCookie,
  });
  return res.data!;
}

export async function activateMfa(
  sessionCookie: string,
  code: string,
): Promise<{ recoveryCodes: string[] }> {
  const res = await apiMutate<{ recoveryCodes: string[] }>({
    method: 'POST',
    path: '/api/v1/account/mfa/activate',
    body: { code },
    sessionCookie,
  });
  return res.data!;
}

export async function disableMfa(sessionCookie: string, code: string): Promise<void> {
  await apiMutate<{ status: 'disabled' }>({
    method: 'POST',
    path: '/api/v1/account/mfa/disable',
    body: { code },
    sessionCookie,
  });
}

export async function regenerateMfaRecoveryCodes(
  sessionCookie: string,
  code: string,
): Promise<{ recoveryCodes: string[] }> {
  const res = await apiMutate<{ recoveryCodes: string[] }>({
    method: 'POST',
    path: '/api/v1/account/mfa/recovery-codes/regenerate',
    body: { code },
    sessionCookie,
  });
  return res.data!;
}
