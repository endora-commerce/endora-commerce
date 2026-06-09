import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';

/**
 * Feature 042 / US2 — admin user enrols in TOTP and completes a two-step
 * Admin UI login (recovery + TOTP), mirroring US1 on the admin surface.
 */
const ADMIN_COOKIE = { b2b_admin_session: 'stub-admin-session' };
const ADMIN_EMAIL = 'platform-admin@example.com';

function totpCode(secretBase32: string, offsetMs = 0): string {
  const totp = new TOTP({
    issuer: 'B2B Platform',
    label: 'verify',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
  return totp.generate({ timestamp: Date.now() + offsetMs });
}

describe('MFA US2 — admin enrol + two-step login', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // FR-001 — 2FA must be enabled for the admin scope before self-enrolment.
    await h.settings.adminService.setValueForAllChannels(
      'mfa.admin.totp_enabled',
      true,
      null,
      { actorAdminUserId: null },
    );
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('enrols an admin and requires the second factor at Admin UI login', async () => {
    const setupRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/account/mfa/setup',
      cookies: ADMIN_COOKIE,
    });
    expect(setupRes.statusCode).toBe(200);
    const { secret } = setupRes.json().data as { secret: string };

    const activateRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/account/mfa/activate',
      cookies: ADMIN_COOKIE,
      payload: { code: totpCode(secret) },
    });
    expect(activateRes.statusCode).toBe(200);
    const recoveryCodes = activateRes.json().data.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);

    const status = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/account/mfa/status',
      cookies: ADMIN_COOKIE,
    });
    expect(status.json().data.totpActive).toBe(true);

    // Admin login now returns mfaRequired (no admin session cookie yet).
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: ADMIN_EMAIL, password: STUB_CUSTOMER_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().data.status).toBe('mfaRequired');
    const challengeId = login.json().data.challengeId as string;
    expect(login.cookies.find((c) => c.name === 'b2b_admin_session')).toBeUndefined();

    // Verify with a recovery code → admin session cookie issued.
    const verify = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/verify',
      payload: { challengeId, code: recoveryCodes[0] },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.cookies.find((c) => c.name === 'b2b_admin_session')?.value).toBeTruthy();

    // A customer challenge must not be verifiable on the admin route, and
    // vice-versa is covered by US1 — here assert TOTP verify works too.
    const login2 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: ADMIN_EMAIL, password: STUB_CUSTOMER_PASSWORD },
    });
    const challengeId2 = login2.json().data.challengeId as string;
    const verify2 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/verify',
      payload: { challengeId: challengeId2, code: totpCode(secret, 30_000) },
    });
    expect(verify2.statusCode).toBe(200);

    // Disable with a recovery code → back to password-only admin login.
    const disable = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/account/mfa/disable',
      cookies: ADMIN_COOKIE,
      payload: { code: recoveryCodes[1] },
    });
    expect(disable.statusCode).toBe(200);

    const loginAfter = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: ADMIN_EMAIL, password: STUB_CUSTOMER_PASSWORD },
    });
    expect(loginAfter.json().data.status).toBe('authenticated');
  });
});
