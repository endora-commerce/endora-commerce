import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  ADMIN_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type CustomerAccountMemberWritePort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * Issue #935 — `POST …/mfa/disable` refuses to remove the account's last
 * second factor while anything requires one, and the status the screens render
 * from says so before the click.
 *
 * Every source the sign-in decision reads is held here, once each, so that no
 * source is stricter than another: `mfa.admin.totp_enforced` and a role's
 * `requiresTwoFactor` for an administrator, `mfa.storefront.totp_enforced` at
 * the request's sales channel and the organization's policy for a customer.
 * Lifting the requirement lets the same request through. The case where
 * another factor remains, and the one without an encryption key, are held by
 * `factor-removal-guard.test.ts` beside the guard — an account holds at most
 * one active enrolment (a partial unique index), and without a key these
 * routes are not served at all.
 */
const STUB_ADMIN = { [ADMIN_SESSION_COOKIE_NAME]: 'stub-admin-session' };
const PASSWORD = 'last-factor-pass-123!';
const ADMIN_EMAIL = 'last-factor-admin@example.com';
const CUSTOMER_EMAIL = 'last-factor-customer@example.test';
const ROLE = 'role_last_factor_int';
const CHANNEL = 'pl_retail';
const ORG_POLICY_TABLE = 'mfa_organization_policies';

const SENTENCE_EN =
  'Two-step verification cannot be switched off on this account, because it is required here — ' +
  'by a security setting, your role or your organization. It stays on while that requirement ' +
  'stands; ask your administrator if it should be lifted.';
const SENTENCE_PL =
  'Weryfikacji dwuetapowej nie można wyłączyć na tym koncie, bo jest tu wymagana — przez ' +
  'ustawienie bezpieczeństwa, Twoją rolę albo Twoją organizację. Pozostaje włączona, dopóki to ' +
  'wymaganie obowiązuje; jeśli ma zostać zniesione, zapytaj administratora.';

function totpCode(secretBase32: string): string {
  return new TOTP({
    issuer: 'B2B Platform',
    label: 'verify',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  }).generate();
}

interface Surface {
  cookieName: string;
  email: string;
  loginUrl: string;
  mfaPrefix: string;
}

const ADMIN: Surface = {
  cookieName: ADMIN_SESSION_COOKIE_NAME,
  email: ADMIN_EMAIL,
  loginUrl: '/api/v1/auth/admin/login',
  mfaPrefix: '/api/v1/admin/account/mfa',
};
const CUSTOMER: Surface = {
  cookieName: SESSION_COOKIE_NAME,
  email: CUSTOMER_EMAIL,
  loginUrl: '/api/v1/auth/customer/login',
  mfaPrefix: '/api/v1/account/mfa',
};

describe('MFA — the last factor cannot be removed while a policy requires one (issue #935)', () => {
  let h: BackendServerHandle;
  const cookies = new Map<Surface, string>();

  async function setSetting(code: string, value: boolean): Promise<void> {
    await h.settings.adminService.setValueForAllChannels(code, value, null, { actorAdminUserId: null });
    await h.settings.cache.invalidate(code);
  }

  /** `mfa.storefront.totp_enforced` on {@link CHANNEL} alone: its own row, which outranks the platform-wide value. */
  async function setChannelEnforced(value: boolean): Promise<void> {
    await h.settings.adminService.setValueForSubset('mfa.storefront.totp_enforced', [CHANNEL], value, null, {
      actorAdminUserId: null,
    });
    await h.settings.cache.invalidate('mfa.storefront.totp_enforced');
  }

  const putRole = (requiresTwoFactor: boolean) =>
    h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/admin-roles/${ROLE}`,
      cookies: STUB_ADMIN,
      payload: { code: ROLE, name: 'Last factor', permissions: ['orders:read'], requiresTwoFactor },
    });

  /** The organization's policy, written as a row: its routes are not this file's subject. */
  async function setOrgPolicy(enforceTotp: boolean): Promise<void> {
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "${ORG_POLICY_TABLE}"
           ("id", "organization_id", "enforce_totp", "updated_by_actor", "created_at", "updated_at")
         values (gen_random_uuid(), ?, ?, 'test', now(), now())
         on conflict ("organization_id") do update set "enforce_totp" = excluded."enforce_totp"`,
        [TEST_ORGANIZATION_ID, enforceTotp],
      );
  }

  async function signIn(s: Surface): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: s.loginUrl,
      payload: { email: s.email, password: PASSWORD },
    });
    expect(res.statusCode, res.body).toBe(200);
    const cookie = (res.cookies as Array<{ name: string; value: string }>).find((c) => c.name === s.cookieName);
    expect(cookie, res.body).toBeDefined();
    return cookie!.value;
  }

  async function enrol(s: Surface): Promise<void> {
    const auth = { [s.cookieName]: cookies.get(s)! };
    const setup = await h.app.inject({ method: 'POST', url: `${s.mfaPrefix}/setup`, cookies: auth });
    expect(setup.statusCode, setup.body).toBe(200);
    const { secret } = (setup.json() as { data: { secret: string } }).data;
    const activate = await h.app.inject({
      method: 'POST',
      url: `${s.mfaPrefix}/activate`,
      cookies: auth,
      payload: { code: totpCode(secret) },
    });
    expect(activate.statusCode, activate.body).toBe(200);
  }

  const disable = (s: Surface, headers: Record<string, string> = {}) =>
    h.app.inject({
      method: 'POST',
      url: `${s.mfaPrefix}/disable`,
      cookies: { [s.cookieName]: cookies.get(s)! },
      headers,
      payload: { password: PASSWORD },
    });

  async function status(s: Surface, headers: Record<string, string> = {}) {
    const res = await h.app.inject({
      method: 'GET',
      url: `${s.mfaPrefix}/status`,
      cookies: { [s.cookieName]: cookies.get(s)! },
      headers,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Record<string, unknown> }).data;
  }

  /** Refused, translated, and the factor is still there. */
  async function expectRefused(s: Surface, headers: Record<string, string> = {}): Promise<void> {
    expect(await status(s, headers)).toMatchObject({
      totpActive: true,
      totpEnforcedForScope: true,
      canDisable: false,
      disableBlockedReason: 'factor_required',
    });
    const res = await disable(s, headers);
    expect(res.statusCode, res.body).toBe(409);
    const error = res.json().error as { code: string; message: string };
    expect(error.code).toBe('MFA_LAST_FACTOR_REQUIRED');
    // The sentence is the bundle's, in whichever language the reader resolves
    // to (an administrator's preference, a channel's language), never the
    // thrower's prose.
    expect([SENTENCE_EN, SENTENCE_PL]).toContain(error.message);
    expect((await status(s, headers))['totpActive']).toBe(true);
  }

  /** Allowed: the status says so, and the factor goes. Re-enrols for the next case. */
  async function expectAllowed(s: Surface, headers: Record<string, string> = {}): Promise<void> {
    expect(await status(s, headers)).toMatchObject({ canDisable: true, disableBlockedReason: null });
    const res = await disable(s, headers);
    expect(res.statusCode, res.body).toBe(200);
    expect((await status(s, headers))['totpActive']).toBe(false);
    await enrol(s);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSetting('mfa.admin.totp_enabled', true);
    await setSetting('mfa.storefront.totp_enabled', true);
    await setSetting('mfa.admin.totp_enforced', false);
    await setSetting('mfa.storefront.totp_enforced', false);
    await setChannelEnforced(false);
    await setOrgPolicy(false);

    const role = await putRole(false);
    expect(role.statusCode, role.body).toBe(200);
    const admin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: STUB_ADMIN,
      payload: {
        email: ADMIN_EMAIL,
        password: PASSWORD,
        firstName: 'Last',
        lastName: 'Factor',
        adminRoleId: (role.json() as { data: { id: string } }).data.id,
      },
    });
    expect(admin.statusCode, admin.body).toBe(201);

    const members = (
      h.container.cradle as unknown as { customerAccountMemberWritePort: CustomerAccountMemberWritePort }
    ).customerAccountMemberWritePort;
    await members.create({
      organizationId: TEST_ORGANIZATION_ID,
      email: CUSTOMER_EMAIL,
      password: PASSWORD,
      firstName: 'Last',
      lastName: 'Factor',
      organizationRoleId: await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member'),
    });
    await h.em().flush();

    for (const s of [ADMIN, CUSTOMER]) {
      cookies.set(s, await signIn(s));
      await enrol(s);
    }
  });

  afterAll(async () => {
    await setSetting('mfa.admin.totp_enforced', false);
    await setSetting('mfa.storefront.totp_enforced', false);
    await setChannelEnforced(false);
    await setSetting('mfa.admin.totp_enabled', false);
    await setSetting('mfa.storefront.totp_enabled', false);
    await setOrgPolicy(false);
    await putRole(false);
    await teardownBackendServer(h);
  });

  it('lets either account remove its factor while nothing requires one', async () => {
    await expectAllowed(ADMIN);
    await expectAllowed(CUSTOMER);
  });

  it('refuses an administrator while mfa.admin.totp_enforced is on', async () => {
    await setSetting('mfa.admin.totp_enforced', true);
    await expectRefused(ADMIN);
    await setSetting('mfa.admin.totp_enforced', false);
    await expectAllowed(ADMIN);
  });

  it("refuses an administrator while the role requires a second factor (#349)", async () => {
    expect((await putRole(true)).statusCode).toBe(200);
    await expectRefused(ADMIN);
    expect((await putRole(false)).statusCode).toBe(200);
    await expectAllowed(ADMIN);
  });

  it('refuses a customer on a channel where mfa.storefront.totp_enforced is on, and only there', async () => {
    await setChannelEnforced(true);
    await expectRefused(CUSTOMER, { 'x-sales-channel': CHANNEL });
    // The system default channel carries no value of its own: not required there.
    expect(await status(CUSTOMER)).toMatchObject({ totpEnforcedForScope: false, canDisable: true });
    await setChannelEnforced(false);
    await expectAllowed(CUSTOMER, { 'x-sales-channel': CHANNEL });
  });

  it("refuses a customer while the organization's policy requires a second factor", async () => {
    await setOrgPolicy(true);
    await expectRefused(CUSTOMER);
    for (const [language, sentence] of [
      ['en', SENTENCE_EN],
      ['pl', SENTENCE_PL],
    ] as const) {
      const res = await disable(CUSTOMER, { 'accept-language': language });
      expect(res.statusCode).toBe(409);
      expect((res.json().error as { message: string }).message).toBe(sentence);
    }
    await setOrgPolicy(false);
    await expectAllowed(CUSTOMER);
  });

  it('does not let an administrator source bind a customer, nor a customer source an administrator', async () => {
    await setSetting('mfa.admin.totp_enforced', true);
    await expectAllowed(CUSTOMER);
    await setSetting('mfa.admin.totp_enforced', false);
    await setOrgPolicy(true);
    await expectAllowed(ADMIN);
    await setOrgPolicy(false);
  });
});
