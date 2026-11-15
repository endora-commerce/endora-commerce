import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerAccount, Organization, Session } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import {
  customerOAuthStartUrl,
  exchangeHandoff,
  oauthBinding,
  sessionOf,
  storefrontBinding,
  type StorefrontBinding,
} from '../../helpers/oauth-binding.js';
import { assignOrganizationChannels } from '../../helpers/sales-channel-access.js';

/**
 * Feature 154, US2 (T045) — the sign-in paths `mfa` owns follow the channel
 * assignment (`contracts/storefront-api.md` §4, `channel-access-rule.md` §6).
 *
 * - The federated callback decides on the channel the sign-in was **started**
 *   on (carried in the OAuth transaction — the provider's redirect carries no
 *   storefront channel), and a refusal sends the browser back to the
 *   storefront's sign-in page with `error=sales_channel_not_permitted` and no
 *   session.
 * - A federated sign-in that creates an account (T046/T056, owner decision D6)
 *   gives the new personal Organization exactly the channel the sign-in was
 *   started on, so the session it issues is accepted there; on a channel closed
 *   to anonymous visitors it creates nothing — no account, no Organization, no
 *   session — as individual self-registration is refused there, and sends the
 *   browser back with `error=sales_channel_sign_in_required`.
 * - The second step re-decides on the channel of the challenge, so an
 *   assignment removed between the password and the code issues no session —
 *   and so does completing an enforced set-up.
 */

const EMAIL = 'stub-customer@example.com';
const OTHER = 'fca-other';
const CLOSED = 'fca-closed';
const STOREFRONT = 'http://localhost:3000';

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

function errorOf(res: { json: () => unknown }): {
  code: string;
  details?: Record<string, unknown>;
} {
  return (res.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
}

async function setSetting(h: BackendServerHandle, code: string, value: boolean): Promise<void> {
  await h.settings.adminService.setValueForAllChannels(code, value, null, {
    actorAdminUserId: null,
  });
}

/**
 * Feature 167 — the storefront page a federated sign-in returns to carries the
 * started-on channel's language prefix (the mfa unit tests pin which one); these
 * cases are about the rest of the address.
 */
const withoutLanguagePrefix = (location: string | undefined): string =>
  (location ?? '').replace(/^(https?:\/\/[^/]+)\/[a-z]{2,3}(?:-[a-z0-9]+)?(?=\/login)/, '$1');

describe('mfa sign-in paths — sales-channel access (T045)', () => {
  let h: BackendServerHandle;

  async function sessionCount(): Promise<number> {
    return h.em().count(Session, { customerAccountId: TEST_CUSTOMER_ID });
  }

  interface Started {
    state: string;
    cookies: Record<string, string>;
    binding: StorefrontBinding;
    channel: string;
  }

  async function start(channel: string): Promise<Started> {
    const binding = storefrontBinding();
    const res = await h.app.inject({
      method: 'GET',
      url: customerOAuthStartUrl(binding),
      headers: { 'x-sales-channel': channel },
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers['location'] as string;
    return { state: new URL(location).searchParams.get('state')!, cookies: oauthBinding(res), binding, channel };
  }

  /**
   * Issue #1279 — a signed-in callback hands off to the storefront, whose
   * server-to-server exchange (on the started-on channel) returns the session.
   */
  async function signedIn(started: Started, email: string = EMAIL): Promise<string> {
    const res = await callback(started, email);
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toMatch(new RegExp(`^${STOREFRONT}/auth/federated/complete\\?code=`));
    expect(res.cookies.find((c) => c.name === 'b2b_session')).toBeUndefined();
    const redeemed = await exchangeHandoff(h.app, res, started.binding, {
      headers: { 'x-sales-channel': started.channel },
    });
    expect(redeemed.statusCode, redeemed.body).toBe(200);
    expect(redeemed.json().data).toMatchObject({ status: 'authenticated', redirectPath: '/account' });
    const session = sessionOf(redeemed);
    expect(session).toBeTruthy();
    return session!;
  }

  function callback(started: Started, email: string = EMAIL) {
    // The provider's redirect: no storefront channel signal at all. The fake
    // provider answers the `code` as the verified e-mail address.
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/customer/oauth/google/callback?code=${encodeURIComponent(email)}&state=${encodeURIComponent(started.state)}`,
      cookies: started.cookies,
    });
  }

  function passwordLogin(channel: string) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      headers: { 'x-sales-channel': channel },
      payload: { email: EMAIL, password: STUB_CUSTOMER_PASSWORD },
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSetting(h, 'mfa.storefront.google_enabled', true);
    await setSetting(h, 'mfa.storefront.totp_enabled', true);
    // Federated sign-in creates an account only where the platform allows an
    // individual one at all; the sign-up cases below need it on.
    await setSetting(h, 'customers.allow_registration_without_organization', true);
    const em = h.em();
    for (const [code, anonymousAccess] of [
      [OTHER, true],
      [CLOSED, false],
    ] as const) {
      em.create(SalesChannel, {
        code,
        name: { 'en-US': code },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
        anonymousAccess,
      });
    }
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default']);
  });

  describe('federated callback', () => {
    it('sends a sign-in started on an unassigned channel back to the sign-in page, without a session', async () => {
      const sessionsBefore = await sessionCount();
      const res = await callback(await start(OTHER));
      expect(res.statusCode).toBe(302);
      expect(withoutLanguagePrefix(res.headers['location'])).toBe(`${STOREFRONT}/login?error=sales_channel_not_permitted`);
      expect(res.cookies.find((c) => c.name === 'b2b_session' && c.value)).toBeUndefined();
      expect(await sessionCount()).toBe(sessionsBefore);
    });

    it('signs in when the started-on channel is assigned', async () => {
      await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default', OTHER]);
      await signedIn(await start(OTHER));
    });
  });

  describe('federated sign-up (D6)', () => {
    it('gives the new personal Organization exactly the channel the sign-in was started on, and signs it in there', async () => {
      const email = `fca-signup-${Date.now()}@example.test`;
      const session = await signedIn(await start(OTHER), email);

      const account = await h.em().findOneOrFail(CustomerAccount, { email });
      const channels = await h.salesChannels.membershipService.listChannelsForEntity(
        'organization',
        account.organizationId!,
      );
      expect(channels.map((c) => c.code)).toEqual([OTHER]);

      const me = await h.app.inject({
        method: 'GET',
        url: '/api/v1/me/customer',
        headers: { 'x-sales-channel': OTHER },
        cookies: { b2b_session: session! },
      });
      expect(me.statusCode, me.body).toBe(200);
    });

    it('creates no account, no Organization and no session on a channel closed to anonymous visitors', async () => {
      const email = `fca-closed-${Date.now()}@example.test`;
      const organizationsBefore = await h.em().count(Organization, {});
      const res = await callback(await start(CLOSED), email);
      expect(res.statusCode).toBe(302);
      expect(withoutLanguagePrefix(res.headers['location'])).toBe(
        `${STOREFRONT}/login?error=sales_channel_sign_in_required`,
      );
      expect(res.cookies.find((c) => c.name === 'b2b_session' && c.value)).toBeUndefined();
      expect(await h.em().findOne(CustomerAccount, { email })).toBeNull();
      expect(await h.em().count(Organization, {})).toBe(organizationsBefore);
    });

    it('still signs an existing account in on a closed channel its Organization is assigned to', async () => {
      await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default', CLOSED]);
      await signedIn(await start(CLOSED));
    });
  });

  describe('enforced set-up', () => {
    it('issues no session when the assignment is removed before the set-up completes', async () => {
      await setSetting(h, 'mfa.storefront.totp_enforced', true);
      try {
        const login = await passwordLogin('default');
        expect(login.statusCode, login.body).toBe(200);
        const { setupTicket } = (login.json() as { data: { status: string; setupTicket: string } })
          .data;
        expect(setupTicket).toBeTruthy();

        const begun = await h.app.inject({
          method: 'POST',
          url: '/api/v1/auth/customer/mfa/setup-ticket/begin',
          payload: { setupTicket },
        });
        expect(begun.statusCode, begun.body).toBe(200);
        const secret = (begun.json() as { data: { secret: string } }).data.secret;

        await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, [OTHER]);
        const sessionsBefore = await sessionCount();
        const completed = await h.app.inject({
          method: 'POST',
          url: '/api/v1/auth/customer/mfa/setup-ticket/complete',
          payload: { setupTicket, code: totpCode(secret) },
        });
        expect(completed.statusCode, completed.body).toBe(403);
        expect(errorOf(completed)).toMatchObject({
          code: ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED,
          details: { channelCode: 'default' },
        });
        expect(completed.headers['set-cookie']).toBeUndefined();
        expect(await sessionCount()).toBe(sessionsBefore);
      } finally {
        await setSetting(h, 'mfa.storefront.totp_enforced', false);
      }
    });
  });

  describe('second-factor verify', () => {
    let recoveryCodes: string[] = [];

    beforeAll(async () => {
      // Runs before the outer `beforeEach`, so it restores the assignment the
      // previous case removed itself.
      await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default']);
      const cookies = { b2b_session: 'stub-customer-session' };
      const setup = await h.app.inject({ method: 'POST', url: '/api/v1/account/mfa/setup', cookies });
      expect(setup.statusCode, setup.body).toBe(200);
      const secret = (setup.json() as { data: { secret: string } }).data.secret;
      const activated = await h.app.inject({
        method: 'POST',
        url: '/api/v1/account/mfa/activate',
        cookies,
        payload: { code: totpCode(secret) },
      });
      expect(activated.statusCode, activated.body).toBe(200);
      recoveryCodes = (activated.json() as { data: { recoveryCodes: string[] } }).data
        .recoveryCodes;
    });

    it('starts no challenge on an unassigned channel', async () => {
      const res = await passwordLogin(OTHER);
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe(ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED);
    });

    it('issues no session when the assignment is removed between the two steps', async () => {
      const login = await passwordLogin('default');
      expect((login.json() as { data: { status: string } }).data.status).toBe('mfaRequired');
      const challengeId = (login.json() as { data: { challengeId: string } }).data.challengeId;

      await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, [OTHER]);
      const sessionsBefore = await sessionCount();
      const verified = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/customer/mfa/verify',
        payload: { challengeId, code: recoveryCodes[0] },
      });
      expect(verified.statusCode, verified.body).toBe(403);
      expect(errorOf(verified)).toMatchObject({
        code: ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED,
        details: { channelCode: 'default' },
      });
      expect(verified.headers['set-cookie']).toBeUndefined();
      expect(await sessionCount()).toBe(sessionsBefore);
    });

    it('completes the second step while the channel stays assigned', async () => {
      const login = await passwordLogin('default');
      const challengeId = (login.json() as { data: { challengeId: string } }).data.challengeId;
      const verified = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/customer/mfa/verify',
        payload: { challengeId, code: recoveryCodes[1] },
      });
      expect(verified.statusCode, verified.body).toBe(200);
      expect(verified.cookies.find((c) => c.name === 'b2b_session')?.value).toBeTruthy();
    });
  });
});
