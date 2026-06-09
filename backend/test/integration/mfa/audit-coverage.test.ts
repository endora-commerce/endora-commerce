import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';

/**
 * Feature 042 — audit coverage (FR-031). Exercises the security-relevant MFA
 * flows and asserts each action string is recorded.
 */
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ORG_ADMIN = CUSTOMER; // TEST_CUSTOMER is the organization_admin
const PLATFORM_ADMIN = { b2b_admin_session: 'stub-admin-session' };

function totp(secret: string, offsetMs = 0): string {
  return new TOTP({
    issuer: 'B2B Platform',
    label: 'verify',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate({ timestamp: Date.now() + offsetMs });
}

describe('MFA — audit coverage', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    for (const code of ['mfa.storefront.totp_enabled', 'mfa.storefront.google_enabled']) {
      await h.settings.adminService.setValueForAllChannels(code, true, null, {
        actorAdminUserId: null,
      });
    }
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function actions(): Promise<Set<string>> {
    const rows = await h.em().find(AuditLogEntry, {});
    return new Set(rows.map((r) => r.action));
  }

  it('records the full set of MFA audit actions', async () => {
    // enable → recovery code login → regenerate → org enforce → reset → social
    const setup = await h.app.inject({ method: 'POST', url: '/api/v1/account/mfa/setup', cookies: CUSTOMER });
    const { secret } = setup.json().data as { secret: string };
    const activate = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/activate',
      cookies: CUSTOMER,
      payload: { code: totp(secret) },
    });
    const recoveryCodes = activate.json().data.recoveryCodes as string[];

    // recovery_code_used via a two-step login.
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: 'stub-customer@example.com', password: 'stub-password-change-me-1234' },
    });
    const challengeId = login.json().data.challengeId as string;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/verify',
      payload: { challengeId, code: recoveryCodes[0] },
    });

    // regenerate (re-auth with a fresh TOTP, next window past the replay guard).
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/recovery-codes/regenerate',
      cookies: CUSTOMER,
      payload: { code: totp(secret, 30_000) },
    });

    // org enforcement.
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/account/organization/mfa-policy',
      cookies: ORG_ADMIN,
      payload: { enforceTotp: true },
    });

    // reset (single).
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${TEST_CUSTOMER_ID}/mfa/reset`,
      cookies: PLATFORM_ADMIN,
    });
    // reset (bulk).
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/mfa/reset-bulk',
      cookies: PLATFORM_ADMIN,
      payload: { organizationId: TEST_ORGANIZATION_ID },
    });

    // social account creation (new email auto-creates a standalone customer).
    const start = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/customer/oauth/google/start',
    });
    const state = new URL(start.headers['location'] as string).searchParams.get('state')!;
    await h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/customer/oauth/google/callback?code=${encodeURIComponent('audit-social@example.com')}&state=${encodeURIComponent(state)}`,
    });

    const recorded = await actions();
    for (const expected of [
      'mfa.enabled',
      'mfa.recovery_code_used',
      'mfa.recovery_codes_regenerated',
      'mfa.org_enforced',
      'mfa.reset',
      'mfa.reset_bulk',
      'mfa.social_account_created',
    ]) {
      expect(recorded.has(expected), `missing audit action: ${expected}`).toBe(true);
    }
  });

  it('records mfa.disabled and mfa.social_linked', async () => {
    // Re-enrol, disable.
    const setup = await h.app.inject({ method: 'POST', url: '/api/v1/account/mfa/setup', cookies: CUSTOMER });
    const { secret } = setup.json().data as { secret: string };
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/activate',
      cookies: CUSTOMER,
      payload: { code: totp(secret) },
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/disable',
      cookies: CUSTOMER,
      payload: { code: totp(secret, 30_000) },
    });

    // social_linked — existing customer signs in via Google.
    const start = await h.app.inject({ method: 'GET', url: '/api/v1/auth/customer/oauth/google/start' });
    const state = new URL(start.headers['location'] as string).searchParams.get('state')!;
    await h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/customer/oauth/google/callback?code=${encodeURIComponent('stub-customer@example.com')}&state=${encodeURIComponent(state)}`,
    });

    const recorded = await actions();
    expect(recorded.has('mfa.disabled')).toBe(true);
    expect(recorded.has('mfa.social_linked')).toBe(true);
  });
});
