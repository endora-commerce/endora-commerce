import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { oauthBinding } from '../../helpers/oauth-binding.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { MfaSocialIdentity } from '../../helpers/package-entities.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';

/**
 * Feature 042 / US4 — storefront federated sign-in (Google), OIDC client faked.
 * Covers: match existing customer, auto-create into a personal organisation
 * (D-178), the registration gate, unverified-email refusal, and the
 * disabled-provider gate.
 *
 * The registration gate is asserted here for the first time (feature 072,
 * T143a cluster 6). Auto-creation has always been gated on
 * `customers.allow_registration_without_organization` in production and on
 * nothing at all in the test harness, because each composition root wrote its
 * own `autoCreateCustomer` closure over `customer_accounts`' table. One
 * implementation serves both now — the module's — so this suite has to say
 * which side of the gate it is testing, and it can finally test the other one.
 */
const EXISTING_EMAIL = 'stub-customer@example.com';

async function setGoogleEnabled(h: BackendServerHandle, enabled: boolean): Promise<void> {
  await h.settings.adminService.setValueForAllChannels(
    'mfa.storefront.google_enabled',
    enabled,
    null,
    { actorAdminUserId: null },
  );
}

/** The B2C gate. Ships **off**, so a suite that wants an auto-create says so. */
async function setStandaloneRegistrationAllowed(
  h: BackendServerHandle,
  allowed: boolean,
): Promise<void> {
  await h.settings.adminService.setValueForAllChannels(
    'customers.allow_registration_without_organization',
    allowed,
    null,
    { actorAdminUserId: null },
  );
}

/**
 * Run /start → extract the opaque state and the browser-binding cookie the
 * callback has to present.
 */
async function startAndGetState(
  h: BackendServerHandle,
): Promise<{ state: string; cookies: Record<string, string> }> {
  const res = await h.app.inject({
    method: 'GET',
    url: '/api/v1/auth/customer/oauth/google/start',
  });
  expect(res.statusCode).toBe(302);
  const location = res.headers['location'] as string;
  return { state: new URL(location).searchParams.get('state')!, cookies: oauthBinding(res) };
}

function callback(
  h: BackendServerHandle,
  code: string,
  started: { state: string; cookies: Record<string, string> },
) {
  return h.app.inject({
    method: 'GET',
    url: `/api/v1/auth/customer/oauth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(started.state)}`,
    cookies: started.cookies,
  });
}

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

/**
 * Feature 167 — the storefront page a federated sign-in returns to carries the
 * started-on channel's language prefix (the mfa unit tests pin which one); these
 * cases are about the rest of the address.
 */
const withoutLanguagePrefix = (location: string | undefined): string =>
  (location ?? '').replace(/^(https?:\/\/[^/]+)\/[a-z]{2,3}(?:-[a-z0-9]+)?(?=\/login)/, '$1');

describe('MFA US4 — customer social login', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setGoogleEnabled(h, true);
    await setStandaloneRegistrationAllowed(h, true);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('signs into an existing customer matched by verified email', async () => {
    const state = await startAndGetState(h);
    const res = await callback(h, EXISTING_EMAIL, state);
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('http://localhost:3000');
    expect(res.cookies.find((c) => c.name === 'b2b_session')?.value).toBeTruthy();

    const link = await h
      .em()
      .findOne(MfaSocialIdentity, { provider: 'google', email: EXISTING_EMAIL });
    expect(link).not.toBeNull();
  });

  /**
   * D-178 W2 — federated sign-in provisions the individual's personal
   * organisation, in the same transaction as the account.
   *
   * This case asserted the opposite until D-178: `expect(created.organizationId
   * ?? null).toBeNull()`, with the comment *"standalone (no org)"*. It was an
   * accurate description of a defect. `autoCreate` provisioned no organisation
   * at all, so **every** account a "sign in with Google" produced carried
   * `organization_id = NULL` permanently — not a window but the steady state of
   * a shipped feature — and the buyer reaching checkout was told to attach an
   * Organization they had no way to attach.
   */
  it('auto-creates a customer in their own personal organization when none matches', async () => {
    const email = 'new-social-customer@example.com';
    const state = await startAndGetState(h);
    const res = await callback(h, email, state);
    expect(res.statusCode).toBe(302);
    expect(res.cookies.find((c) => c.name === 'b2b_session')?.value).toBeTruthy();

    const created = await h.em().findOne(CustomerAccount, { email });
    expect(created).not.toBeNull();
    expect(created!.organizationId).toBeTruthy();

    // A single-member personal organisation, named from the address' local part
    // — the provider sends no name with the claim this seam reads.
    const org = await h.em().findOne(Organization, { id: created!.organizationId });
    expect(org).not.toBeNull();
    expect(org!.isPersonal).toBe(true);
    expect(org!.status).toBe('active');
    expect(org!.name).toBe('new-social-customer');

    // Issue #122 — the other way an account appears without an admin
    // (`customers`' standalone self-registration) has always recorded an entry
    // with a null actor; this path recorded nothing, because the coverage scan
    // never opened a `backend.ts`. An account arriving out of a federated
    // sign-in is exactly what an operator later has to be able to explain.
    const audit = await h
      .em()
      .find(AuditLogEntry, {
        action: 'customer_account.register_social',
        objectId: created!.id,
      });
    expect(audit).toHaveLength(1);
    // Names and structure only: the address is the account's, not the audit log's (D-288, #470).
    expect(audit[0]!.stateAfter).toMatchObject({ changedFields: expect.arrayContaining(['email', 'organizationId']) });
    expect(JSON.stringify(audit[0]!.stateAfter)).not.toContain(email);
  });

  it('refuses to auto-create while org-less registration is off', async () => {
    await setStandaloneRegistrationAllowed(h, false);
    const email = 'refused-social-customer@example.com';
    const state = await startAndGetState(h);
    const res = await callback(h, email, state);

    // `registration_disabled_in_channel` (issue #789) — no session, and no account behind it.
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login?error=registration_disabled_in_channel');
    expect(res.cookies.find((c) => c.name === 'b2b_session')).toBeUndefined();
    expect(await h.em().findOne(CustomerAccount, { email })).toBeNull();

    await setStandaloneRegistrationAllowed(h, true);
  });

  it('refuses an unverified provider email', async () => {
    const state = await startAndGetState(h);
    const res = await callback(h, 'unverified@example.com', state);
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login?error=email_unverified');
    expect(res.cookies.find((c) => c.name === 'b2b_session')).toBeUndefined();
  });

  it('refuses to start when the provider is disabled', async () => {
    await setGoogleEnabled(h, false);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/customer/oauth/google/start',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login?error=provider_unavailable');
    await setGoogleEnabled(h, true);
  });

  it('refuses a callback from a browser that did not start the sign-in', async () => {
    const { state } = await startAndGetState(h);
    const res = await callback(h, EXISTING_EMAIL, { state, cookies: {} });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login?error=sign_in_expired');
    expect(res.cookies.find((c) => c.name === 'b2b_session' && c.value)).toBeUndefined();

    // Nor does a binding cookie from another sign-in attempt open this one.
    const other = await startAndGetState(h);
    const mismatched = await callback(h, EXISTING_EMAIL, { state, cookies: other.cookies });
    expect(mismatched.headers['location']).toContain('/login?error=');
    expect(mismatched.cookies.find((c) => c.name === 'b2b_session' && c.value)).toBeUndefined();
  });

  it('refuses a blocked customer as the password sign-in refuses it', async () => {
    const em = h.em();
    const account = await em.findOneOrFail(CustomerAccount, { email: EXISTING_EMAIL });
    account.blockedAt = new Date();
    await em.flush();
    try {
      const password = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/customer/login',
        payload: { email: EXISTING_EMAIL, password: STUB_CUSTOMER_PASSWORD },
      });
      expect(password.statusCode).toBe(403);

      const started = await startAndGetState(h);
      const res = await callback(h, EXISTING_EMAIL, started);
      expect(res.statusCode).toBe(302);
      // The password sign-in's refusal and the callback's are the same refusal: the
      // storefront words `account_blocked` as the API's ACCOUNT_BLOCKED (issue #789).
      expect(password.json()).toMatchObject({ error: { code: 'ACCOUNT_BLOCKED' } });
      expect(withoutLanguagePrefix(res.headers['location'])).toBe('http://localhost:3000/login?error=account_blocked');
      expect(res.cookies.find((c) => c.name === 'b2b_session' && c.value)).toBeUndefined();
    } finally {
      const restore = h.em();
      const again = await restore.findOneOrFail(CustomerAccount, { email: EXISTING_EMAIL });
      again.blockedAt = null;
      await restore.flush();
    }
  });

  it('hands a customer with an active second factor to the code screen, not a session', async () => {
    const email = 'enrolled-social-customer@example.com';
    await h.settings.adminService.setValueForAllChannels('mfa.storefront.totp_enabled', true, null, {
      actorAdminUserId: null,
    });

    // First sign-in creates the account and signs it in; it then enrols.
    const first = await callback(h, email, await startAndGetState(h));
    const session = first.cookies.find((c) => c.name === 'b2b_session')!.value;
    const setup = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/setup',
      cookies: { b2b_session: session },
    });
    const secret = (setup.json().data as { secret: string }).secret;
    const activated = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/activate',
      cookies: { b2b_session: session },
      payload: { code: totpCode(secret) },
    });
    expect(activated.statusCode, activated.body).toBe(200);

    // The next federated sign-in stops at the second factor.
    const res = await callback(h, email, await startAndGetState(h));
    expect(res.statusCode).toBe(302);
    expect(withoutLanguagePrefix(res.headers['location'])).toBe(
      `http://localhost:3000/login/mfa?next=${encodeURIComponent('/account')}`,
    );
    expect(res.cookies.find((c) => c.name === 'b2b_session' && c.value)).toBeUndefined();
    const challengeId = res.cookies.find((c) => c.name === 'b2b_mfa_challenge')?.value;
    expect(challengeId).toBeTruthy();

    // And the challenge is the one the password sign-in's code screen completes.
    const verified = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/mfa/verify',
      // The next time step: the replay guard refuses the step activation used.
      payload: { challengeId, code: totpCode(secret, 30_000) },
    });
    expect(verified.statusCode, verified.body).toBe(200);
    expect(verified.cookies.find((c) => c.name === 'b2b_session')?.value).toBeTruthy();
  });
});
