import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CustomerAccountMemberWritePort,
  CustomerPasswordResetPort,
  CustomerPasswordStatePort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../../packages/modules/customers/src/manifest.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Issue #222 — `passwordSetAt` records that a password was actually set.
 *
 * `password_hash` cannot answer that question: federated auto-create mints a
 * random one, so `password_hash is not null` is true for every account and true
 * for accounts nobody ever gave a password to. Every write of a **caller-supplied**
 * password stamps the new column; the generated one deliberately does not.
 *
 * The four stamping sites are asserted through the surface each one is really
 * reached by, not by calling the setter: a site that stops stamping leaves an
 * account in the "never set" state for good, and nothing else in the tree would
 * notice.
 */
describe('customer_accounts — passwordSetAt (issue #222)', () => {
  let h: BackendServerHandle;

  const passwordState = (): CustomerPasswordStatePort =>
    (h.container.cradle as unknown as { customerPasswordStatePort: CustomerPasswordStatePort })
      .customerPasswordStatePort;

  const memberWrite = (): CustomerAccountMemberWritePort =>
    (
      h.container.cradle as unknown as {
        customerAccountMemberWritePort: CustomerAccountMemberWritePort;
      }
    ).customerAccountMemberWritePort;

  const passwordReset = (): CustomerPasswordResetPort =>
    (h.container.cradle as unknown as { passwordResetService: CustomerPasswordResetPort })
      .passwordResetService;

  const socialLogin = (): { autoCreate(email: string): Promise<{ id: string } | null> } =>
    (
      h.container.cradle as unknown as {
        customerSocialLoginPort: { autoCreate(email: string): Promise<{ id: string } | null> };
      }
    ).customerSocialLoginPort;

  async function rowFor(email: string): Promise<CustomerAccount> {
    const row = await h.em().findOne(CustomerAccount, { email });
    expect(row, `the fixture really created ${email}`).not.toBeNull();
    return row!;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    // Standalone registration and federated auto-create are both gated by this
    // setting, and both are sites under test.
    const reconciler = new ManifestReconciler(h.em());
    await reconciler.apply([customersManifest.settings!]);
    const enabled = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customers.allow_registration_without_organization/value',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { scope: 'all', value: true },
    });
    if (enabled.statusCode !== 200) {
      throw new Error(`enable registration failed: ${enabled.statusCode} ${enabled.body}`);
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('stamps the column when a visitor registers with a password of their own', async () => {
    const email = `pw-set-register-${Date.now()}@example.test`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: {
        email,
        password: 'a-very-strong-pass',
        firstName: 'Stand',
        lastName: 'Alone',
        acceptedTermsVersion: 'v1',
      },
    });
    expect(res.statusCode).toBe(201);

    const account = await rowFor(email);
    expect(account.passwordSetAt).toBeInstanceOf(Date);
  });

  it('stamps the column when a member is created with a password through the write port', async () => {
    const email = `pw-set-member-${Date.now()}@example.test`;
    const created = await memberWrite().create({
      organizationId: TEST_ORGANIZATION_ID,
      email,
      password: 'another-very-strong-pass',
      firstName: 'New',
      lastName: 'Member',
      role: 'regular_user',
    });

    const account = await rowFor(created.email);
    expect(account.passwordSetAt).toBeInstanceOf(Date);
  });

  it('stamps the column when a reset token is redeemed for a new password', async () => {
    const email = `pw-set-reset-${Date.now()}@example.test`;
    const created = await memberWrite().create({
      organizationId: TEST_ORGANIZATION_ID,
      email,
      password: 'the-password-they-forgot',
      firstName: 'Reset',
      lastName: 'Me',
      role: 'regular_user',
    });
    // Back to "no password on record", so the assertion below is about the
    // confirm and not about the create two lines above it.
    const before = await h.em().findOne(CustomerAccount, { id: created.id });
    before!.passwordSetAt = null;
    await h.em().flush();

    // The route that mints the token e-mails it and returns nothing, so the
    // raw value is taken from the port the route calls. The write under test is
    // the confirm below, which does go through the route.
    const { rawToken } = await passwordReset().requestReset(email);
    expect(rawToken, 'the request minted a token').toBeTruthy();

    const confirmed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token: rawToken, newPassword: 'a-brand-new-strong-pass' },
    });
    expect(confirmed.statusCode).toBeLessThan(300);

    const account = await rowFor(email);
    expect(account.passwordSetAt).toBeInstanceOf(Date);
  });

  it('stamps the column when the holder changes their own password', async () => {
    // The harness seeds this account by writing the row, which is exactly the
    // "we do not know" state the migration backfills: no registration, no reset
    // and no change ever ran for it.
    const seeded = await h.em().findOne(CustomerAccount, { id: TEST_CUSTOMER_ID });
    seeded!.passwordSetAt = null;
    await h.em().flush();

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/password',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        currentPassword: STUB_CUSTOMER_PASSWORD,
        newPassword: 'a-strong-replacement-pass',
      },
    });
    expect(res.statusCode).toBeLessThan(300);

    h.em().clear();
    const after = await h.em().findOne(CustomerAccount, { id: TEST_CUSTOMER_ID });
    expect(after!.passwordSetAt).toBeInstanceOf(Date);

    // Put the seeded password back so the account other files rely on is the
    // one they were written against.
    const restored = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/password',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        currentPassword: 'a-strong-replacement-pass',
        newPassword: STUB_CUSTOMER_PASSWORD,
      },
    });
    expect(restored.statusCode).toBeLessThan(300);
  });

  it('leaves the column null when federated sign-in auto-creates the account', async () => {
    const email = `pw-set-social-${Date.now()}@example.test`;
    const created = await socialLogin().autoCreate(email);
    expect(created, 'auto-create is allowed in this composition').not.toBeNull();

    const account = await rowFor(email);
    // The hash is a random pair of UUIDs nobody was told — a value, not a
    // credential. `password_hash is not null` says yes here; the new column is
    // the one that says what is true.
    expect(account.passwordHash).not.toBe('');
    expect(account.passwordSetAt ?? null).toBeNull();
    expect(await passwordState().passwordSetAt(created!.id)).toBeNull();
  });

  it('answers null for an account that does not exist, rather than throwing', async () => {
    expect(await passwordState().passwordSetAt('00000000-0000-4000-8000-00000000dead')).toBeNull();
  });
});
