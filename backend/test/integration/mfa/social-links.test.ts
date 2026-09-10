import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { MfaSocialIdentity, type MfaSocialIdentityRow } from '../../helpers/package-entities.js';

/**
 * Issue #194 — a customer can see the identities linked to their account and
 * sever one.
 *
 * The contract has declared `socialLinks` on the status response since feature
 * 042; the handler returned a hard-coded `[]`, so the storefront had nothing to
 * render and no route existed to unlink. Both halves are asserted here.
 *
 * The refusal is the part worth reading. An account created *by* a federated
 * sign-in holds a random password nobody was ever told
 * (`customer_accounts/backend.ts`), so removing its only link removes the only
 * credential its holder can use. Issue #222 gave the platform the datum that
 * tells the two apart — `customer_accounts.password_set_at` — so the rule is no
 * longer "refuse every last link" but "refuse the last link of an account with
 * no password on record", and the sentence names the step that lifts it.
 */
const CUSTOMER_COOKIE = { b2b_session: 'stub-customer-session' };
const CUSTOMER_EMAIL = 'stub-customer@example.com';
const ADMIN_COOKIE = { b2b_admin_session: 'stub-admin-session' };

interface SocialLinkSummary {
  provider: string;
  email: string;
  linkedAt: string;
  canUnlink: boolean;
  unlinkBlockedReason: string | null;
}

describe('MFA social identity links — list + unlink (issue #194)', () => {
  let h: BackendServerHandle;
  let customerId = '';

  async function status(): Promise<SocialLinkSummary[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/account/mfa/status',
      cookies: CUSTOMER_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    return (res.json().data as { socialLinks: SocialLinkSummary[] }).socialLinks;
  }

  function unlink(provider: string) {
    return h.app.inject({
      method: 'DELETE',
      url: `/api/v1/account/mfa/social-links/${provider}`,
      cookies: CUSTOMER_COOKIE,
    });
  }

  function linkRows(): Promise<MfaSocialIdentityRow[]> {
    return h.em().find(MfaSocialIdentity, { subjectId: customerId });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.settings.adminService.setValueForAllChannels(
      'mfa.storefront.google_enabled',
      true,
      null,
      { actorAdminUserId: null },
    );
    // Link through the real federated sign-in, so the fixture is a row this
    // platform actually writes rather than one this test invented.
    const start = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/customer/oauth/google/start',
    });
    const state = new URL(start.headers['location'] as string).searchParams.get('state')!;
    await h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/customer/oauth/google/callback?code=${encodeURIComponent(CUSTOMER_EMAIL)}&state=${encodeURIComponent(state)}`,
    });
    const google = await h
      .em()
      .findOne(MfaSocialIdentity, { provider: 'google', email: CUSTOMER_EMAIL });
    expect(google, 'the fixture really linked an identity').not.toBeNull();
    customerId = google!.subjectId;
  });

  // Exactly one Google link, and no password on record, before each test — so
  // no order decides an outcome. The second half matters since issue #222: the
  // refusal now reads `password_set_at`, and the test below that sets one would
  // otherwise decide the verdict of every test after it.
  beforeEach(async () => {
    const em = h.em();
    await em.nativeDelete(MfaSocialIdentity, { subjectId: customerId });
    em.create(MfaSocialIdentity, {
      subjectType: 'customer',
      subjectId: customerId,
      provider: 'google',
      providerSubject: 'google-sub-194',
      email: CUSTOMER_EMAIL,
    });
    await em.nativeUpdate(CustomerAccount, { id: customerId }, { passwordSetAt: null });
    await em.flush();
    em.clear();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists the linked identity the account actually holds', async () => {
    const links = await status();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ provider: 'google', email: CUSTOMER_EMAIL });
    expect(typeof links[0]!.linkedAt).toBe('string');
  });

  it('refuses to remove the only link of an account with no password on record', async () => {
    const links = await status();
    expect(links[0]).toMatchObject({
      canUnlink: false,
      unlinkBlockedReason: 'last_credential',
    });

    const res = await unlink('google');
    expect(res.statusCode).toBe(409);
    expect(res.json().error?.code).toBe('MFA_SOCIAL_LAST_CREDENTIAL');
    // The sentence, not the raw code: `MFA_*` had no translation route at all,
    // so the envelope would have rendered whatever prose the thrower wrote.
    // This is the bundle's wording, which differs from the thrower's on
    // purpose — it is the discriminator that says the lookup really happened.
    expect(res.json().error?.message).toBe(
      'This is the last sign-in identity linked to the account, and the account has no ' +
        'password on record — removing it could lock its holder out for good. Set a password ' +
        'for the account first, then this link can be removed.',
    );
    // Issue #222 — the instruction is back, and it is back because it now
    // works: `password_set_at` is what the rule reads, and the next test walks
    // the step this sentence names.
    expect(res.json().error?.message).toContain('Set a password');
    // A refusal is a refusal: the row is untouched.
    expect(await linkRows()).toHaveLength(1);
  });

  it('removes a link when another one remains, and audits the removal', async () => {
    const em = h.em();
    em.create(MfaSocialIdentity, {
      subjectType: 'customer',
      subjectId: customerId,
      provider: 'microsoft',
      providerSubject: 'microsoft-sub-194',
      email: CUSTOMER_EMAIL,
    });
    await em.flush();

    const before = await status();
    expect(before).toHaveLength(2);
    expect(before.every((l) => l.canUnlink)).toBe(true);

    const res = await unlink('google');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ status: 'unlinked', provider: 'google' });

    const remaining = await linkRows();
    expect(remaining.map((r) => r.provider)).toEqual(['microsoft']);

    // Constitution XIII — a security-relevant account change is auditable.
    const audit = await h
      .em()
      .find(AuditLogEntry, { action: 'mfa.social_unlink', objectId: customerId });
    expect(audit).toHaveLength(1);
    expect((audit[0]!.stateBefore as { provider?: string } | null)?.provider).toBe('google');

    // And the survivor is the last credential now, so it is refused in turn.
    const after = await status();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ provider: 'microsoft', canUnlink: false });
  });

  it('removes the only link once the holder has set a password (issue #222)', async () => {
    // The step the refusal above names, walked through the route a holder
    // really walks. Nothing else about the account changes.
    const changed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/password',
      cookies: CUSTOMER_COOKIE,
      payload: {
        currentPassword: STUB_CUSTOMER_PASSWORD,
        newPassword: 'a-password-the-holder-picked',
      },
    });
    expect(changed.statusCode, changed.body).toBeLessThan(300);

    const links = await status();
    expect(links[0]).toMatchObject({ canUnlink: true, unlinkBlockedReason: null });

    const res = await unlink('google');
    expect(res.statusCode).toBe(200);
    expect(await linkRows()).toHaveLength(0);

    // Leave the seeded credential as the rest of the harness expects it.
    const restored = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/password',
      cookies: CUSTOMER_COOKIE,
      payload: {
        currentPassword: 'a-password-the-holder-picked',
        newPassword: STUB_CUSTOMER_PASSWORD,
      },
    });
    expect(restored.statusCode).toBeLessThan(300);
  });

  it('404s a provider this account has no link for', async () => {
    const res = await unlink('microsoft');
    expect(res.statusCode).toBe(404);
  });

  it('refuses a provider the platform does not know', async () => {
    const res = await unlink('facebook');
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.code).toBe('VALIDATION_FAILED');
  });

  it('answers only for the authenticated subject — the admin surface sees none of it', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/account/mfa/status',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as { socialLinks: SocialLinkSummary[] }).socialLinks).toEqual([]);
  });

  /**
   * Issue #222 — the admin arm needs no column, because an `admin_users` row
   * cannot exist without a password somebody supplied: `create` takes a
   * required `password`, and federated sign-in's admin branch matches an
   * existing admin and never creates one. So an admin's last link is severable,
   * and `test/unit/mfa/admin-password-is-structural.test.ts` is what keeps that
   * premise from rotting quietly.
   */
  it('lets an admin remove their last link — an admin password is always one a person set', async () => {
    const em = h.em();
    em.create(MfaSocialIdentity, {
      subjectType: 'admin',
      subjectId: TEST_ADMIN_ID,
      provider: 'google',
      providerSubject: 'google-sub-222-admin',
      email: 'stub-admin@example.com',
    });
    await em.flush();

    const listed = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/account/mfa/status',
      cookies: ADMIN_COOKIE,
    });
    const links = (listed.json().data as { socialLinks: SocialLinkSummary[] }).socialLinks;
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ canUnlink: true, unlinkBlockedReason: null });

    const res = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/account/mfa/social-links/google',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await h.em().find(MfaSocialIdentity, { subjectId: TEST_ADMIN_ID })).toHaveLength(0);
  });
});
