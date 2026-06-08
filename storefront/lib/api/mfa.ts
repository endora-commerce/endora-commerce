import { apiMutate, apiGetAuthed } from './mutations';
import type { RequestContext } from './client';

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
