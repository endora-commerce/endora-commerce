import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { ADMIN_SESSION_COOKIE_NAME } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PLATFORM_ADMIN_ROLE_ID } from '../../helpers/seed-admins.js';
import { Session } from '../../helpers/package-entities.js';

/**
 * A login begun with a password cannot be finished once that password is gone.
 *
 * After the password verifies, sign-in hands out a short-lived artefact — a
 * challenge for an enrolled administrator, a setup ticket for one who must
 * enrol — and the second step mints the session from it. Neither was withdrawn
 * when the password changed or the account was deactivated, so:
 *
 *  (a) a setup ticket obtained with the old password still enrolled the
 *      holder's authenticator and signed them in after the change;
 *  (b) a challenge obtained with the old password still completed;
 *  (c) a challenge completed after a deactivation left a session behind that
 *      started answering when the account was reactivated.
 */

const EMAIL = 'pending-login@example.com';
const P1 = 'pending-first-pass-123!';
const P2 = 'pending-second-pass-456!';
const P3 = 'pending-third-pass-789!';
const STUB_ADMIN = { b2b_session: 'stub-admin-session' };

function totpCode(secretBase32: string, offsetMs = 0): string {
  return new TOTP({
    issuer: 'B2B Platform',
    label: 'verify',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  }).generate({ timestamp: Date.now() + offsetMs });
}

describe('MFA — pending logins are withdrawn with the credential', () => {
  let h: BackendServerHandle;
  let adminId: string;
  let secret: string;
  let session: string;

  async function login(password: string): Promise<Record<string, string>> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: EMAIL, password },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: Record<string, string> }).data;
  }

  async function post(url: string, payload: Record<string, unknown>) {
    return h.app.inject({ method: 'POST', url, payload });
  }

  function errorCode(res: { json: () => unknown }): string | undefined {
    return (res.json() as { error?: { code?: string } }).error?.code;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    for (const code of ['mfa.admin.totp_enabled', 'mfa.admin.totp_enforced']) {
      await h.settings.adminService.setValueForAllChannels(code, true, null, {
        actorAdminUserId: null,
      });
    }
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: STUB_ADMIN,
      payload: {
        email: EMAIL,
        password: P1,
        firstName: 'Pen',
        lastName: 'Ding',
        adminRoleId: PLATFORM_ADMIN_ROLE_ID,
      },
    });
    expect(create.statusCode).toBe(201);
    adminId = (create.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('(a) a setup ticket issued under the old password dies with a peer reset', async () => {
    const begun = await login(P1);
    expect(begun['status']).toBe('mfaSetupRequired');
    const staleTicket = begun['setupTicket']!;

    const reset = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/admin-users/${adminId}/password`,
      cookies: STUB_ADMIN,
      payload: { password: P2 },
    });
    expect(reset.statusCode).toBe(200);

    const begin = await post('/api/v1/auth/admin/mfa/setup-ticket/begin', {
      setupTicket: staleTicket,
    });
    expect(begin.statusCode).toBe(400);
    expect(errorCode(begin)).toBe('MFA_INVALID_CHALLENGE');
    const complete = await post('/api/v1/auth/admin/mfa/setup-ticket/complete', {
      setupTicket: staleTicket,
      code: '000000',
    });
    expect(complete.statusCode).toBe(400);
    expect(await h.em().count(Session, { adminUserId: adminId })).toBe(0);

    // A login begun with the new password works, and enrols the administrator.
    const fresh = await login(P2);
    expect(fresh['status']).toBe('mfaSetupRequired');
    const setup = await post('/api/v1/auth/admin/mfa/setup-ticket/begin', {
      setupTicket: fresh['setupTicket'],
    });
    expect(setup.statusCode).toBe(200);
    secret = (setup.json() as { data: { secret: string } }).data.secret;
    const done = await post('/api/v1/auth/admin/mfa/setup-ticket/complete', {
      setupTicket: fresh['setupTicket'],
      code: totpCode(secret),
    });
    expect(done.statusCode).toBe(200);
    session = (done.cookies as Array<{ name: string; value: string }>).find(
      (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
    )!.value;
  });

  it('(b) a challenge issued under the old password dies with a self-service change', async () => {
    const begun = await login(P2);
    expect(begun['status']).toBe('mfaRequired');

    const change = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: session },
      payload: { password: P3, currentPassword: P2 },
    });
    expect(change.statusCode).toBe(200);

    // The second factor is right; the challenge is what is gone.
    const verify = await post('/api/v1/auth/admin/mfa/verify', {
      challengeId: begun['challengeId'],
      code: totpCode(secret, 30_000),
    });
    expect(verify.statusCode).toBe(400);
    expect(errorCode(verify)).toBe('MFA_INVALID_CHALLENGE');
    // Only the session that made the change is left.
    expect(await h.em().count(Session, { adminUserId: adminId })).toBe(1);

    // A login begun with the new password completes.
    const fresh = await login(P3);
    const ok = await post('/api/v1/auth/admin/mfa/verify', {
      challengeId: fresh['challengeId'],
      code: totpCode(secret, 30_000),
    });
    expect(ok.statusCode).toBe(200);
  });

  it('(c) a challenge cannot be completed after a deactivation, nor after the reactivation', async () => {
    const begun = await login(P3);
    expect(begun['status']).toBe('mfaRequired');

    const setStatus = async (status: 'active' | 'inactive'): Promise<void> => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/admin-users/${adminId}`,
        cookies: STUB_ADMIN,
        payload: { status },
      });
      expect(res.statusCode).toBe(200);
    };
    await setStatus('inactive');

    const whileInactive = await post('/api/v1/auth/admin/mfa/verify', {
      challengeId: begun['challengeId'],
      code: totpCode(secret, -30_000),
    });
    expect(whileInactive.statusCode).toBe(400);
    expect(errorCode(whileInactive)).toBe('MFA_INVALID_CHALLENGE');
    expect(await h.em().count(Session, { adminUserId: adminId })).toBe(0);

    await setStatus('active');
    const afterReactivation = await post('/api/v1/auth/admin/mfa/verify', {
      challengeId: begun['challengeId'],
      code: totpCode(secret, -30_000),
    });
    expect(afterReactivation.statusCode).toBe(400);
    expect(await h.em().count(Session, { adminUserId: adminId })).toBe(0);
  });
});
