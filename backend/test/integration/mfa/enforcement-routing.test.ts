import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';

/**
 * Feature 042 / US3 — 2FA enforcement. Org-admins (storefront) and Platform
 * Admins set per-organization enforcement; an enforced-but-unenrolled customer
 * is routed into mandatory setup at login and enrols via a setup ticket
 * (no session until activation).
 */
const ORG_ADMIN = { b2b_session: 'stub-customer-session' }; // TEST_CUSTOMER (organization_admin)
const REGULAR = { b2b_session: 'stub-customer-session-rfq' }; // regular_user
const PLATFORM_ADMIN = { b2b_admin_session: 'stub-admin-session' };
const RESTRICTED_ADMIN = { b2b_admin_session: 'stub-restricted-admin-session' };

const RFQ_EMAIL = 'stub-customer-rfq@example.com';
const EMPTY_EMAIL = 'stub-customer-empty@example.com';

function totpCode(secret: string): string {
  return new TOTP({
    issuer: 'B2B Platform',
    label: 'verify',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function loginStatus(h: BackendServerHandle, email: string) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/customer/login',
    payload: { email, password: STUB_CUSTOMER_PASSWORD },
  });
  return res.json().data as { status: string; setupTicket?: string; challengeId?: string };
}

describe('MFA US3 — enforcement routing + org policy', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('org-admin can enforce; a regular member cannot', async () => {
    const ok = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/account/organization/mfa-policy',
      cookies: ORG_ADMIN,
      payload: { enforceTotp: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.enforceTotp).toBe(true);

    const denied = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/account/organization/mfa-policy',
      cookies: REGULAR,
      payload: { enforceTotp: true },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('routes an enforced, unenrolled customer into mandatory setup, then enrols', async () => {
    // Enforcement is ON from the previous test.
    const login = await loginStatus(h, RFQ_EMAIL);
    expect(login.status).toBe('mfaSetupRequired');
    const setupTicket = login.setupTicket!;
    expect(setupTicket).toBeTruthy();

    // Begin enrolment with the ticket (no session yet).
    const begin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/setup-ticket/begin',
      payload: { setupTicket },
    });
    expect(begin.statusCode).toBe(200);
    const { secret } = begin.json().data as { secret: string };

    // Complete → activates + issues a session + recovery codes.
    const complete = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/setup-ticket/complete',
      payload: { setupTicket, code: totpCode(secret) },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().data.status).toBe('authenticated');
    expect(complete.json().data.recoveryCodes).toHaveLength(10);
    expect(complete.cookies.find((c) => c.name === 'b2b_session')?.value).toBeTruthy();

    // Now enrolled → next login is the normal second step, not setup.
    const next = await loginStatus(h, RFQ_EMAIL);
    expect(next.status).toBe('mfaRequired');
  });

  it('disabling enforcement stops forcing unenrolled members', async () => {
    // Still enforced — a different unenrolled member is forced.
    const forced = await loginStatus(h, EMPTY_EMAIL);
    expect(forced.status).toBe('mfaSetupRequired');

    // Org-admin turns enforcement off.
    const off = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/account/organization/mfa-policy',
      cookies: ORG_ADMIN,
      payload: { enforceTotp: false },
    });
    expect(off.statusCode).toBe(200);

    const free = await loginStatus(h, EMPTY_EMAIL);
    expect(free.status).toBe('authenticated');
  });

  it('platform admin can set org enforcement; restricted admin cannot', async () => {
    const ok = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/mfa-policy`,
      cookies: PLATFORM_ADMIN,
      payload: { enforceTotp: false },
    });
    expect(ok.statusCode).toBe(200);

    const denied = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/mfa-policy`,
      cookies: RESTRICTED_ADMIN,
      payload: { enforceTotp: true },
    });
    expect(denied.statusCode).toBe(403);
  });
});
