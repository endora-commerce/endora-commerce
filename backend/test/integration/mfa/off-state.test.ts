import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { PasswordResetToken } from '../../../src/modules/customer_accounts/entities/password-reset-token.entity.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { MfaEnrolment } from '../../helpers/package-entities.js';

/**
 * `mfa` off-state — Constitution XVII item 6, feature 042 FR-033, D-96.
 *
 * **This test could not have been written before its own merge request.** The
 * harness resolved `mfaLoginPort` off the cradle once, at composition, and
 * handed both login consumers a getter returning the captured value: a captured
 * gate goes on answering after the module is switched off, so every assertion
 * below would have passed against a module that was still running — the shape
 * issue #141 found four times. Deleting that capture is what makes the file
 * mean anything, and it is why assertion 1 (the negative control) comes first.
 *
 * What it proves, in the order the checklist asks for it:
 *
 *  1. the control: with `mfa` on, both surfaces really do demand a second
 *     factor, so the fixture enrolled somebody;
 *  2. with `mfa` deactivated — platform-available, operator off, the case
 *     Constitution XVII names — admin and customer login **succeed on the
 *     password alone**, which is the degrade FR-033 has always required and
 *     which `master` answered with a 503 on every login;
 *  3. the module's own surfaces refuse, its configuration is not editable, and
 *     both presence projections report it absent;
 *  4. nothing was dropped: the same enrolment rows come back, and a TOTP code
 *     from the *original* secret verifies after the module is switched on;
 *  5. the one account the degrade does not repair — a customer auto-created by
 *     a federated sign-in holds a random password nobody knows — has the route
 *     back the `whenAbsent` sentence promises: a password reset.
 */

const ADMIN_COOKIE = { b2b_admin_session: 'stub-admin-session' };
const ADMIN_EMAIL = 'platform-admin@example.com';
const CUSTOMER_COOKIE = { b2b_session: 'stub-customer-session' };
const CUSTOMER_EMAIL = 'stub-customer@example.com';
const SOCIAL_EMAIL = 'social-only-customer@example.com';
/** Filled in `beforeAll` from the federated sign-in's own `Set-Cookie`. */
const SOCIAL_CUSTOMER_COOKIE = { b2b_session: '' };

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

describe('mfa off-state — login degrades to password-only (D-96, FR-033)', () => {
  let h: BackendServerHandle;
  let adminSecret = '';
  let customerSecret = '';
  let adminEnrolmentId = '';
  let customerEnrolmentId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    for (const code of [
      'mfa.admin.totp_enabled',
      'mfa.storefront.totp_enabled',
      'mfa.storefront.google_enabled',
      'customers.allow_registration_without_organization',
    ]) {
      await h.settings.adminService.setValueForAllChannels(code, true, null, {
        actorAdminUserId: null,
      });
    }

    // Enrol both subjects. The rows are the "nothing is dropped" evidence, so
    // their ids are captured here and compared after restoration.
    const adminSetup = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/account/mfa/setup',
      cookies: ADMIN_COOKIE,
    });
    adminSecret = (adminSetup.json().data as { secret: string }).secret;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/account/mfa/activate',
      cookies: ADMIN_COOKIE,
      payload: { code: totpCode(adminSecret) },
    });

    const customerSetup = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/setup',
      cookies: CUSTOMER_COOKIE,
    });
    customerSecret = (customerSetup.json().data as { secret: string }).secret;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/activate',
      cookies: CUSTOMER_COOKIE,
      payload: { code: totpCode(customerSecret) },
    });

    const enrolments = await h.em().find(MfaEnrolment, { status: 'active' });
    adminEnrolmentId = enrolments.find((e) => e.subjectType === 'admin')!.id;
    customerEnrolmentId = enrolments.find((e) => e.subjectType === 'customer')!.id;

    // The federated-sign-in strand: an account this platform created from a
    // verified Google identity, with a random password nobody was ever told.
    const start = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/customer/oauth/google/start',
    });
    const state = new URL(start.headers['location'] as string).searchParams.get('state')!;
    const callback = await h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/customer/oauth/google/callback?code=${encodeURIComponent(SOCIAL_EMAIL)}&state=${encodeURIComponent(state)}`,
    });
    // The session that sign-in minted — the only way to speak *as* the account
    // the platform created, which is the account issue #194 is about.
    SOCIAL_CUSTOMER_COOKIE.b2b_session =
      callback.cookies.find((c) => c.name === 'b2b_session')!.value;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminLogin = () =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: ADMIN_EMAIL, password: STUB_CUSTOMER_PASSWORD },
    });

  const customerLogin = () =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: CUSTOMER_EMAIL, password: STUB_CUSTOMER_PASSWORD },
    });

  it('the fixture really enrolled somebody — the control the rest rests on', async () => {
    expect(adminEnrolmentId).toBeTruthy();
    expect(customerEnrolmentId).toBeTruthy();
    expect(await h.em().findOne(CustomerAccount, { email: SOCIAL_EMAIL })).not.toBeNull();

    const admin = await adminLogin();
    expect(admin.statusCode).toBe(200);
    expect(admin.json().data.status).toBe('mfaRequired');
    expect(admin.cookies.find((c) => c.name === 'b2b_admin_session')).toBeUndefined();

    const customer = await customerLogin();
    expect(customer.statusCode).toBe(200);
    expect(customer.json().data.status).toBe('mfaRequired');
    expect(customer.cookies.find((c) => c.name === 'b2b_session')).toBeUndefined();
  });

  it('deactivated: both logins succeed on the password alone', async () => {
    await withModuleOff('mfa', 'deactivated', async () => {
      const admin = await adminLogin();
      expect(admin.statusCode).toBe(200);
      expect(admin.json().data.status).toBe('authenticated');
      expect(admin.cookies.find((c) => c.name === 'b2b_admin_session')?.value).toBeTruthy();

      const customer = await customerLogin();
      expect(customer.statusCode).toBe(200);
      expect(customer.json().data.status).toBe('authenticated');
      expect(customer.cookies.find((c) => c.name === 'b2b_session')?.value).toBeTruthy();
    });
  });

  it('deactivated: the module contributes no surface of its own', async () => {
    await expectModuleAbsent(h, 'mfa', {
      routes: [
        { method: 'POST', url: '/api/v1/auth/admin/mfa/verify', payload: { challengeId: 'x', code: '000000' } },
        { method: 'POST', url: '/api/v1/auth/customer/mfa/verify', payload: { challengeId: 'x', code: '000000' } },
        { method: 'GET', url: '/api/v1/admin/account/mfa/status', cookies: ADMIN_COOKIE },
        { method: 'GET', url: '/api/v1/account/mfa/status', cookies: CUSTOMER_COOKIE },
        // Issue #194 — the identity list and the unlink are `mfa`'s surface
        // too, so they go with it. The unlink is asserted against a link that
        // really exists (the fixture's), so the 503 is the gate refusing and
        // not a 404 that would answer the same way with the module on.
        {
          method: 'DELETE',
          url: '/api/v1/account/mfa/social-links/google',
          cookies: SOCIAL_CUSTOMER_COOKIE,
        },
      ],
      adminPresence: { cookies: ADMIN_COOKIE },
      settingWrite: {
        code: 'mfa.storefront.totp_enabled',
        value: false,
        cookies: ADMIN_COOKIE,
      },
    });
  });

  it('deactivated: the platform still offers it, and the storefront is told it is gone', async () => {
    await withModuleOff('mfa', 'deactivated', async () => {
      const admin = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/module-presence',
        cookies: ADMIN_COOKIE,
      });
      const entry = (admin.json() as { modules: Array<Record<string, unknown>> }).modules.find(
        (m) => m['id'] === 'mfa',
      );
      // The case Constitution XVII names: platform-available, operator off.
      // `platformState` is the deployment's word for "installed here" — the
      // harness seeds `installed`, production `enabled`; what matters is that it
      // is not one of the absent ones.
      expect(entry).toMatchObject({ present: false, activated: false, deactivatable: true });
      expect(['installed', 'enabled']).toContain(entry?.['platformState']);

      // The OAuth start route is `mfa`'s too. It is asserted here rather than
      // through `expectModuleAbsent` because it answers a bodiless 302 while
      // the module is on, and the shared helper reads a JSON envelope.
      const oauth = await h.app.inject({
        method: 'GET',
        url: '/api/v1/auth/customer/oauth/google/start',
      });
      expect(oauth.statusCode).toBe(503);
      expect(oauth.json().error?.code).toBe('MODULE_DISABLED');

      const storefront = await h.app.inject({
        method: 'GET',
        url: '/api/v1/storefront/module-presence',
      });
      expect(
        (storefront.json() as { modules: Array<{ id: string; present: boolean }> }).modules,
      ).toContainEqual({ id: 'mfa', present: false });

      // The activation control is not editable through the generic settings
      // screen either — feature 073 FR-009, `effectiveState.activationControlOwner`.
      const flip = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/settings/mfa.enabled/value',
        cookies: ADMIN_COOKIE,
        payload: { value: true },
      });
      expect(flip.statusCode).toBeGreaterThanOrEqual(400);
    });
  });

  it('deactivated: a socially-created customer has password reset as its route back', async () => {
    await withModuleOff('mfa', 'deactivated', async () => {
      // No password was ever chosen for this account, so no password works —
      // and with the module off there is no provider button either. This is the
      // half of `whenAbsent` the degrade does not repair, named there so an
      // operator reads it before flipping.
      const refused = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/customer/login',
        payload: { email: SOCIAL_EMAIL, password: STUB_CUSTOMER_PASSWORD },
      });
      expect(refused.statusCode).toBe(401);

      const reset = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset/request',
        payload: { email: SOCIAL_EMAIL },
      });
      expect(reset.statusCode).toBe(202);

      // 202 is unconditional (account-enumeration defence), so the proof that
      // the account is reachable is the token row, not the status code.
      const account = await h.em().findOne(CustomerAccount, { email: SOCIAL_EMAIL });
      const tokens = await h
        .em()
        .find(PasswordResetToken, { customerAccountId: account!.id });
      expect(tokens.length).toBeGreaterThan(0);
    });
  });

  it('restored: the same enrolments challenge again, from the original secrets', async () => {
    const admin = await adminLogin();
    expect(admin.json().data.status).toBe('mfaRequired');
    const challengeId = admin.json().data.challengeId as string;

    const verify = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/verify',
      payload: { challengeId, code: totpCode(adminSecret, 30_000) },
    });
    expect(verify.statusCode).toBe(200);

    const enrolments = await h.em().find(MfaEnrolment, { status: 'active' });
    expect(enrolments.find((e) => e.subjectType === 'admin')?.id).toBe(adminEnrolmentId);
    expect(enrolments.find((e) => e.subjectType === 'customer')?.id).toBe(customerEnrolmentId);
  });

  it('restored: the social identity link is listed again, unchanged (issue #194)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/account/mfa/status',
      cookies: SOCIAL_CUSTOMER_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const links = (res.json().data as { socialLinks: Array<Record<string, unknown>> }).socialLinks;
    expect(links).toHaveLength(1);
    // The account the federated sign-in created: one link, and the module
    // refuses to remove it because it is the only credential its holder has —
    // the same account whose route back in, with `mfa` off, is a password
    // reset. Switching the module off and on again changed neither.
    expect(links[0]).toMatchObject({
      provider: 'google',
      email: SOCIAL_EMAIL,
      canUnlink: false,
      unlinkBlockedReason: 'last_credential',
    });
  });

  it('reports the live enrolment count the deactivation dialog renders', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/modules/mfa/deactivation-impact',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      moduleId: 'mfa',
      activeSecondFactorUsers: { admins: 1, customers: 1 },
    });

    // Already off ⇒ there is no dialog to render, and no count. The number is
    // read while the module is still on, through an open gate; it is never a
    // reason to refuse a flip.
    await withModuleOff('mfa', 'deactivated', async () => {
      const off = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/modules/mfa/deactivation-impact',
        cookies: ADMIN_COOKIE,
      });
      expect(off.statusCode).toBe(200);
      expect(off.json()).toEqual({ moduleId: 'mfa', activeSecondFactorUsers: null });
    });
  });
});
