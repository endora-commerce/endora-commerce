import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';

/**
 * Feature 042 / US1 — customer enrols in TOTP, then completes a two-step login
 * with both a recovery code and a TOTP code. Exercises the real DB, the real
 * module boundary (login service ↔ MFA port), Redis-backed challenges, and the
 * AES-GCM secret cipher end-to-end over HTTP.
 *
 * Consolidates the US1 contract assertions (self-service setup/activate/status
 * + login union + verify) into one journey.
 */
const CUSTOMER_COOKIE = { b2b_session: 'stub-customer-session' };
const CUSTOMER_EMAIL = 'stub-customer@example.com';

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

describe('MFA US1 — customer enrol + two-step login', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // FR-001 — 2FA must be enabled for the scope before self-enrolment.
    await h.settings.adminService.setValueForAllChannels(
      'mfa.storefront.totp_enabled',
      true,
      null,
      { actorAdminUserId: null },
    );
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('enrols, activates, and logs in with recovery + TOTP codes', async () => {
    // --- setup: returns a secret + otpauth URI -----------------------------
    const setupRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/setup',
      cookies: CUSTOMER_COOKIE,
    });
    expect(setupRes.statusCode).toBe(200);
    const { secret, otpauthUri } = setupRes.json().data as {
      secret: string;
      otpauthUri: string;
    };
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(otpauthUri).toContain('otpauth://totp/');

    // Status before activation: not active.
    const preStatus = await h.app.inject({
      method: 'GET',
      url: '/api/v1/account/mfa/status',
      cookies: CUSTOMER_COOKIE,
    });
    expect(preStatus.json().data.totpActive).toBe(false);

    // --- activate: confirm with a live code → recovery codes once ----------
    const activateRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/activate',
      cookies: CUSTOMER_COOKIE,
      payload: { code: totpCode(secret) },
    });
    expect(activateRes.statusCode).toBe(200);
    const recoveryCodes = activateRes.json().data.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);

    const postStatus = await h.app.inject({
      method: 'GET',
      url: '/api/v1/account/mfa/status',
      cookies: CUSTOMER_COOKIE,
    });
    expect(postStatus.json().data).toMatchObject({
      totpActive: true,
      recoveryCodesRemaining: 10,
    });

    // --- login step 1: password → mfaRequired, NO session cookie -----------
    const login1 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: CUSTOMER_EMAIL, password: STUB_CUSTOMER_PASSWORD },
    });
    expect(login1.statusCode).toBe(200);
    expect(login1.json().data.status).toBe('mfaRequired');
    const challengeId1 = login1.json().data.challengeId as string;
    expect(challengeId1).toBeTruthy();
    expect(login1.cookies.find((c) => c.name === 'b2b_session')).toBeUndefined();

    // --- verify with a recovery code → authenticated + session cookie ------
    const verify1 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/verify',
      payload: { challengeId: challengeId1, code: recoveryCodes[0] },
    });
    expect(verify1.statusCode).toBe(200);
    expect(verify1.json().data.status).toBe('authenticated');
    expect(verify1.cookies.find((c) => c.name === 'b2b_session')?.value).toBeTruthy();

    // --- recovery code is single-use ---------------------------------------
    const login2 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: CUSTOMER_EMAIL, password: STUB_CUSTOMER_PASSWORD },
    });
    const challengeId2 = login2.json().data.challengeId as string;
    const verifyReuse = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/verify',
      payload: { challengeId: challengeId2, code: recoveryCodes[0] },
    });
    expect(verifyReuse.statusCode).toBe(401);

    // --- verify with a TOTP code (next window, past the replay guard) ------
    const login3 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: CUSTOMER_EMAIL, password: STUB_CUSTOMER_PASSWORD },
    });
    const challengeId3 = login3.json().data.challengeId as string;
    const totp = totpCode(secret, 30_000);
    const verify3 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/verify',
      payload: { challengeId: challengeId3, code: totp },
    });
    expect(verify3.statusCode).toBe(200);

    // Same TOTP code replayed on a new challenge is rejected (replay guard).
    const login4 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: CUSTOMER_EMAIL, password: STUB_CUSTOMER_PASSWORD },
    });
    const challengeId4 = login4.json().data.challengeId as string;
    const verifyReplay = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/verify',
      payload: { challengeId: challengeId4, code: totp },
    });
    expect(verifyReplay.statusCode).toBe(401);

    // --- disable (re-auth with an unused recovery code) → password-only ----
    const disableRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/disable',
      cookies: CUSTOMER_COOKIE,
      payload: { code: recoveryCodes[1] },
    });
    expect(disableRes.statusCode).toBe(200);

    const finalStatus = await h.app.inject({
      method: 'GET',
      url: '/api/v1/account/mfa/status',
      cookies: CUSTOMER_COOKIE,
    });
    expect(finalStatus.json().data.totpActive).toBe(false);

    const loginAfterDisable = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: CUSTOMER_EMAIL, password: STUB_CUSTOMER_PASSWORD },
    });
    expect(loginAfterDisable.json().data.status).toBe('authenticated');
  });
});
