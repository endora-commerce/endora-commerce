import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  ADMIN_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type CustomerAccountMemberWritePort,
} from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PLATFORM_ADMIN_ROLE_ID } from '../../helpers/seed-admins.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Removing a second factor withdraws what was obtained while it stood.
 *
 * A session established with a second factor must not outlive the removal of
 * that factor on another device, and a login begun before the removal must not
 * be completed after it. Disabling the factor oneself keeps the session the
 * request was made from and ends the others; a reset performed by an
 * administrator ends all of them. Enrolling one's own first factor ends
 * nothing.
 */

const STUB_ADMIN = { [ADMIN_SESSION_COOKIE_NAME]: 'stub-admin-session' };
const ADMIN_EMAIL = 'factor-removal-admin@example.com';
const CUSTOMER_EMAIL = 'factor-removal-customer@example.test';
const PASSWORD = 'factor-removal-pass-123!';
const SETTINGS = [
  'mfa.admin.totp_enabled',
  'mfa.storefront.totp_enabled',
  'mfa.storefront.totp_enforced',
];

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

interface Surface {
  cookieName: string;
  email: string;
  loginUrl: string;
  meUrl: string;
  mfaPrefix: string;
  verifyUrl: string;
}

const ADMIN: Surface = {
  cookieName: ADMIN_SESSION_COOKIE_NAME,
  email: ADMIN_EMAIL,
  loginUrl: '/api/v1/auth/admin/login',
  meUrl: '/api/v1/admin/me',
  mfaPrefix: '/api/v1/admin/account/mfa',
  verifyUrl: '/api/v1/auth/admin/mfa/verify',
};
const CUSTOMER: Surface = {
  cookieName: SESSION_COOKIE_NAME,
  email: CUSTOMER_EMAIL,
  loginUrl: '/api/v1/auth/customer/login',
  meUrl: '/api/v1/me/customer',
  mfaPrefix: '/api/v1/account/mfa',
  verifyUrl: '/api/v1/auth/customer/mfa/verify',
};

describe('MFA — removing a factor withdraws sessions and pending logins', () => {
  let h: BackendServerHandle;
  let customerId: string;
  let adminId: string;
  /** The step after the one enrolment accepted: the replay guard refuses a repeat. */
  const laterCode = (secret: string): string => totpCode(secret, 30_000);

  async function setSetting(code: string, value: boolean): Promise<void> {
    await h.settings.adminService.setValueForAllChannels(code, value, null, {
      actorAdminUserId: null,
    });
  }

  async function login(s: Surface) {
    const res = await h.app.inject({
      method: 'POST',
      url: s.loginUrl,
      payload: { email: s.email, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const cookie = (res.cookies as Array<{ name: string; value: string }>).find(
      (c) => c.name === s.cookieName,
    );
    return { data: (res.json() as { data: Record<string, string> }).data, cookie: cookie?.value };
  }

  async function post(url: string, payload: Record<string, unknown>, cookies?: Record<string, string>) {
    return h.app.inject({ method: 'POST', url, payload, ...(cookies ? { cookies } : {}) });
  }

  async function meStatus(s: Surface, cookie: string): Promise<number> {
    const res = await h.app.inject({ method: 'GET', url: s.meUrl, cookies: { [s.cookieName]: cookie } });
    return res.statusCode;
  }

  async function enrol(s: Surface, cookie: string): Promise<string> {
    const cookies = { [s.cookieName]: cookie };
    const setup = await post(`${s.mfaPrefix}/setup`, {}, cookies);
    expect(setup.statusCode).toBe(200);
    const { secret } = (setup.json() as { data: { secret: string } }).data;
    const activate = await post(`${s.mfaPrefix}/activate`, { code: totpCode(secret) }, cookies);
    expect(activate.statusCode).toBe(200);
    return secret;
  }

  function errorCode(res: { json: () => unknown }): string | undefined {
    return (res.json() as { error?: { code?: string } }).error?.code;
  }

  /** Signs in twice, enrols from the first session, begins a third login. */
  async function scenario(s: Surface) {
    const calling = (await login(s)).cookie!;
    const other = (await login(s)).cookie!;
    const secret = await enrol(s, calling);
    // Enrolling one's own factor ends no session.
    expect(await meStatus(s, other)).toBe(200);
    const begun = await login(s);
    expect(begun.data['status']).toBe('mfaRequired');
    return { calling, other, secret, challengeId: begun.data['challengeId']! };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSetting('mfa.admin.totp_enabled', true);
    await setSetting('mfa.storefront.totp_enabled', true);
    const admin = await post(
      '/api/v1/admin/admin-users',
      {
        email: ADMIN_EMAIL,
        password: PASSWORD,
        firstName: 'Factor',
        lastName: 'Removal',
        adminRoleId: PLATFORM_ADMIN_ROLE_ID,
      },
      { b2b_session: 'stub-admin-session' },
    );
    expect(admin.statusCode).toBe(201);
    adminId = (admin.json() as { data: { id: string } }).data.id;
    const members = (
      h.container.cradle as unknown as {
        customerAccountMemberWritePort: CustomerAccountMemberWritePort;
      }
    ).customerAccountMemberWritePort;
    const created = await members.create({
      organizationId: TEST_ORGANIZATION_ID,
      email: CUSTOMER_EMAIL,
      password: PASSWORD,
      firstName: 'Factor',
      lastName: 'Removal',
      role: 'regular_user',
    });
    await h.em().flush();
    customerId = created.id;
  });

  afterAll(async () => {
    for (const code of SETTINGS) await setSetting(code, false);
    await teardownBackendServer(h);
  });

  for (const s of [ADMIN, CUSTOMER]) {
    it(`self-service disable (${s.mfaPrefix}) ends the other sessions and keeps the calling one`, async () => {
      const { calling, other, secret, challengeId } = await scenario(s);

      const disable = await post(
        `${s.mfaPrefix}/disable`,
        { code: laterCode(secret) },
        { [s.cookieName]: calling },
      );
      expect(disable.statusCode).toBe(200);

      expect(await meStatus(s, calling)).toBe(200);
      expect(await meStatus(s, other)).toBe(401);
      // The login begun before the removal is withdrawn, not merely unanswerable.
      const verify = await post(s.verifyUrl, { challengeId, code: laterCode(secret) });
      expect(verify.statusCode).toBe(400);
      expect(errorCode(verify)).toBe('MFA_INVALID_CHALLENGE');

      const rows = await h.em().find(AuditLogEntry, {
        action: 'mfa.disabled',
        objectId: s === ADMIN ? adminId : customerId,
      });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const dump = JSON.stringify(rows);
      expect(dump).not.toContain(secret);
      expect(dump).not.toContain(PASSWORD);
    });
  }

  it("an administrator's reset ends every session of the customer and the login they had begun", async () => {
    const { calling, other, secret, challengeId } = await scenario(CUSTOMER);

    const reset = await post(`/api/v1/admin/customers/${customerId}/mfa/reset`, {}, STUB_ADMIN);
    expect(reset.statusCode).toBe(200);
    expect((reset.json() as { data: { affected: boolean } }).data.affected).toBe(true);

    expect(await meStatus(CUSTOMER, calling)).toBe(401);
    expect(await meStatus(CUSTOMER, other)).toBe(401);
    const verify = await post(CUSTOMER.verifyUrl, { challengeId, code: laterCode(secret) });
    expect(verify.statusCode).toBe(400);
    expect(errorCode(verify)).toBe('MFA_INVALID_CHALLENGE');

    const rows = await h.em().find(AuditLogEntry, { action: 'mfa.reset', objectId: customerId });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it('a setup ticket issued before a reset cannot be used after it', async () => {
    await setSetting('mfa.storefront.totp_enforced', true);
    const begun = await login(CUSTOMER);
    expect(begun.data['status']).toBe('mfaSetupRequired');
    const setupTicket = begun.data['setupTicket']!;
    // The ticket has started an enrolment, which is what the reset removes.
    const started = await post('/api/v1/auth/customer/mfa/setup-ticket/begin', { setupTicket });
    expect(started.statusCode).toBe(200);

    const reset = await post(`/api/v1/admin/customers/${customerId}/mfa/reset`, {}, STUB_ADMIN);
    expect((reset.json() as { data: { affected: boolean } }).data.affected).toBe(true);

    const again = await post('/api/v1/auth/customer/mfa/setup-ticket/begin', { setupTicket });
    expect(again.statusCode).toBe(400);
    expect(errorCode(again)).toBe('MFA_INVALID_CHALLENGE');
  });

  it('a reset that removes nothing ends no session', async () => {
    await setSetting('mfa.storefront.totp_enforced', false);
    const session = (await login(CUSTOMER)).cookie!;
    const reset = await post(`/api/v1/admin/customers/${customerId}/mfa/reset`, {}, STUB_ADMIN);
    expect((reset.json() as { data: { affected: boolean } }).data.affected).toBe(false);
    expect(await meStatus(CUSTOMER, session)).toBe(200);
  });
});
