import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { oauthBinding } from '../../helpers/oauth-binding.js';
import { CustomerAccount } from '../../helpers/package-entities.js';

/**
 * Issue #652 (D-292) — where a customer account's preferred language comes from.
 *
 * Captured from the **creating request** — its first `Accept-Language` tag
 * resolved against the request's channel (`scopeLanguageOf`: exact, else the
 * same base language, else the channel default) — on every path a buyer
 * creates an account through: organisation registration, B2C registration,
 * invitation accept and a first federated sign-in. An operator's direct create
 * has no buyer request to read it from and leaves it unknown.
 *
 * Filled at **sign-in only while unknown**, and only by a sign-in that was
 * accepted: a wrong password or a blocked account captures nothing, and
 * neither does an operator impersonating the buyer. Never overwritten by a
 * sign-in — only the buyer's own choice does that (the self-service contract
 * test).
 *
 * Every account here is this file's own, on this file's own channel
 * (`pl-PL` default, `en-US` offered).
 */
const PASSWORD = 'a-very-strong-pass-652!';
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('customer preferred language — capture (#652)', () => {
  let h: BackendServerHandle;
  let channel: { id: string; code: string };
  let serial = 0;

  const unique = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
  const on = (acceptLanguage?: string) => ({
    'x-sales-channel': channel.code,
    ...(acceptLanguage !== undefined ? { 'accept-language': acceptLanguage } : {}),
  });

  async function languageOf(email: string): Promise<string | null> {
    const em = h.em();
    em.clear();
    const row = await em.findOne(CustomerAccount, { email });
    expect(row, `the fixture created ${email}`).not.toBeNull();
    return row!.preferredLanguage ?? null;
  }

  async function registerOrganization(acceptLanguage: string): Promise<{ email: string; organizationId: string }> {
    serial += 1;
    const email = unique('pl652-org');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      headers: on(acceptLanguage),
      payload: {
        organization: {
          name: `Language Co ${serial} ${randomUUID().slice(0, 6)}`,
          taxId: `PL652${String(Date.now()).slice(-5)}${String(serial).padStart(2, '0')}`,
          registeredAddress: { street: 'ul. Językowa 1', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
        },
        firstUser: { email, password: PASSWORD, firstName: 'Lang', lastName: 'Uage' },
        acceptedTermsVersion: '1.0.0',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: { organization: { id: string } } };
    return { email, organizationId: body.data.organization.id };
  }

  /** An account an operator created on the organisation panel: no language yet. */
  async function operatorCreatedMember(organizationId: string): Promise<string> {
    const email = unique('pl652-member');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${organizationId}/members`,
      headers: on('pl-PL'),
      cookies: ADMIN,
      payload: { email, password: PASSWORD, firstName: 'Op', lastName: 'Created' },
    });
    expect(res.statusCode, res.body).toBe(201);
    return email;
  }

  const signIn = (email: string, acceptLanguage: string, password = PASSWORD) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      headers: on(acceptLanguage),
      payload: { email, password },
    });

  async function federatedSignIn(email: string, acceptLanguage: string) {
    const started = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/customer/oauth/google/start',
      headers: on(acceptLanguage),
    });
    expect(started.statusCode, started.body).toBe(302);
    const state = new URL(started.headers['location'] as string).searchParams.get('state')!;
    // The fake OIDC client reads the code as the verified e-mail.
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/customer/oauth/google/callback?code=${encodeURIComponent(email)}&state=${encodeURIComponent(state)}`,
      cookies: oauthBinding(started),
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const code = `pl652-${randomUUID().slice(0, 8)}`;
    const created = em.create(SalesChannel, {
      code,
      name: { 'en-US': code },
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      anonymousAccess: true,
    });
    await em.flush();
    channel = { id: created.id, code };
    await h.salesChannels.cache.invalidateAll();
    const actor = { actorAdminUserId: null };
    await h.settings.adminService.setValueForAllChannels(
      'customers.allow_registration_without_organization',
      true,
      null,
      actor,
    );
    await h.settings.adminService.setValueForAllChannels('mfa.storefront.google_enabled', true, null, actor);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('at creation', () => {
    it.each([
      ['pl-PL', 'pl-PL', 'the exact language'],
      ['en', 'en-US', 'the channel language of the same base'],
      ['de-DE,de;q=0.9', 'pl-PL', 'the channel default for a language it does not offer'],
    ])('organisation registration in %s records %s (%s)', async (acceptLanguage, expected) => {
      const { email } = await registerOrganization(acceptLanguage);
      expect(await languageOf(email)).toBe(expected);
    });

    it('B2C registration records the registering request’s language', async () => {
      const email = unique('pl652-b2c');
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/customers/register',
        headers: on('en-GB'),
        payload: { email, password: PASSWORD, firstName: 'Bee', lastName: 'Toc', acceptedTermsVersion: 'v1' },
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(await languageOf(email)).toBe('en-US');
    });

    it('invitation accept records the invitee’s language, not the inviter’s', async () => {
      const email = unique('pl652-invitee');
      const invite = await h.app.inject({
        method: 'POST',
        url: '/api/v1/organizations/mine/invitations',
        headers: { 'accept-language': 'pl-PL' },
        cookies: { b2b_session: 'stub-customer-session' },
        payload: { email },
      });
      expect(invite.statusCode, invite.body).toBe(201);
      const probe = await h.app.inject({ method: 'GET', url: '/api/v1/_test/latest-invitation-token' });
      const { token } = probe.json() as { token: string };

      const accept = await h.app.inject({
        method: 'POST',
        url: `/api/v1/organizations/invitations/${token}/accept`,
        headers: on('en-US'),
        payload: { password: PASSWORD, firstName: 'Inv', lastName: 'Itee' },
      });
      expect(accept.statusCode, accept.body).toBe(200);
      expect(await languageOf(email)).toBe('en-US');
    });

    it('a first federated sign-in records the language of the page it was started on', async () => {
      const email = unique('pl652-federated-new');
      const res = await federatedSignIn(email, 'en-US');
      expect(res.statusCode).toBe(302);
      expect(res.headers['location'] ?? '').not.toContain('error=');
      expect(await languageOf(email)).toBe('en-US');
    });

    it('an operator’s direct create records none, whatever language the operator reads', async () => {
      const { organizationId } = await registerOrganization('pl-PL');
      const email = await operatorCreatedMember(organizationId);
      expect(await languageOf(email)).toBeNull();
    });
  });

  describe('at sign-in, only while unknown', () => {
    it('fills an unknown language at the first accepted password sign-in and never overwrites it', async () => {
      const { organizationId } = await registerOrganization('pl-PL');
      const email = await operatorCreatedMember(organizationId);

      const first = await signIn(email, 'en-US');
      expect(first.statusCode, first.body).toBe(200);
      expect(await languageOf(email)).toBe('en-US');

      const second = await signIn(email, 'pl-PL');
      expect(second.statusCode, second.body).toBe(200);
      expect(await languageOf(email)).toBe('en-US');
    });

    it('captures nothing from a wrong password or a blocked account', async () => {
      const { organizationId } = await registerOrganization('pl-PL');
      const email = await operatorCreatedMember(organizationId);

      const wrong = await signIn(email, 'en-US', 'not-the-password-at-all');
      expect(wrong.statusCode).toBe(401);
      expect(await languageOf(email)).toBeNull();

      const em = h.em();
      const row = await em.findOneOrFail(CustomerAccount, { email });
      row.blockedAt = new Date();
      row.blockSource = 'staff';
      await em.flush();
      const blocked = await signIn(email, 'en-US');
      expect(blocked.statusCode).toBe(403);
      expect(await languageOf(email)).toBeNull();
    });

    it('captures nothing while an operator impersonates the buyer', async () => {
      const { organizationId } = await registerOrganization('pl-PL');
      const email = await operatorCreatedMember(organizationId);
      const { id } = await h.em().findOneOrFail(CustomerAccount, { email });

      const started = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/customers/${id}/impersonate`,
        headers: on('en-US'),
        cookies: ADMIN,
        payload: { reason: 'issue #652' },
      });
      expect(started.statusCode, started.body).toBe(200);
      expect(await languageOf(email)).toBeNull();
    });

    it('fills an unknown language at a federated sign-in to an existing account, and never overwrites it', async () => {
      const { organizationId } = await registerOrganization('pl-PL');
      const email = await operatorCreatedMember(organizationId);

      const first = await federatedSignIn(email, 'en-US');
      expect(first.statusCode).toBe(302);
      expect(first.headers['location'] ?? '').not.toContain('error=');
      expect(await languageOf(email)).toBe('en-US');

      const second = await federatedSignIn(email, 'pl-PL');
      expect(second.statusCode).toBe(302);
      expect(await languageOf(email)).toBe('en-US');
    });
  });
});
