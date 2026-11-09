import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { MfaOrganizationPolicy } from '../../helpers/package-entities.js';

/**
 * Issue #947 — customer two-step requirements on an instance with no
 * `MFA_SECRET_ENCRYPTION_KEY`, on the terms #930 (PR #946) set for
 * `mfa.admin.totp_enforced`.
 *
 * Without the key `mfa` serves no enrolment route, so the setup step a
 * requirement sends an unenrolled customer to cannot be completed. PR #967
 * already signs every subject in without a second step there; this file holds
 * what was still missing:
 *
 *  - `mfa.storefront.totp_enforced` refuses to be turned on, platform-wide or
 *    for a channel, with `MFA_ENFORCEMENT_UNAVAILABLE` and
 *    `details.reason: 'encryption_key_missing'`; turning it off, and saving
 *    `true` over `true`, are accepted;
 *  - the Settings screen says it is not in force while it is on;
 *  - an organization's policy refuses the same off → on write, from the
 *    storefront administrator and from the Admin UI alike, and can always be
 *    lifted — before this, neither route existed without a key, so a policy set
 *    while the key was there could not be lifted at all.
 *
 * The harness pins the key for every file, so this one withholds it before it
 * composes and puts it back afterwards.
 */
const STUB_ADMIN = { b2b_session: 'stub-admin-session' };
const ORG_ADMIN = { b2b_session: 'stub-customer-session' }; // TEST_CUSTOMER, the Administrator role
const ENFORCED = 'mfa.storefront.totp_enforced';
const CHANNEL = 'pl_retail';
const RFQ_EMAIL = 'stub-customer-rfq@example.com';

const SENTENCE_EN =
  'Customers cannot be required to use two-step verification on this instance, because no ' +
  'second factor can be set up: the encryption key MFA_SECRET_ENCRYPTION_KEY is not configured. ' +
  'Ask whoever runs this platform to set it, then try again.';

describe('customer two-step requirements without an encryption key (issue #947)', () => {
  let h: BackendServerHandle;
  let savedKey: string | undefined;

  const putEnforced = (payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${ENFORCED}/value`,
      cookies: STUB_ADMIN,
      payload,
    });

  const forceGlobal = async (value: boolean) => {
    await h
      .em()
      .getConnection()
      .execute(`update "settings" set "global_value" = ?::jsonb where "code" = ?`, [
        JSON.stringify(value),
        ENFORCED,
      ]);
    await h.settings.cache.invalidateAfterWrite(ENFORCED);
  };

  const notice = async (): Promise<unknown> => {
    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/settings/${ENFORCED}`,
      cookies: STUB_ADMIN,
    });
    expect(detail.statusCode).toBe(200);
    return (detail.json() as { notice?: unknown }).notice;
  };

  const putOrgPolicy = (enforceTotp: boolean) =>
    h.app.inject({
      method: 'PUT',
      url: '/api/v1/account/organization/mfa-policy',
      cookies: ORG_ADMIN,
      payload: { enforceTotp },
    });

  const postAdminOrgPolicy = (enforceTotp: boolean) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/mfa-policy`,
      cookies: STUB_ADMIN,
      payload: { enforceTotp },
    });

  const storedPolicy = async (): Promise<boolean | null> =>
    withSystemScope('read the org policy row back', async () => {
      const row = await h.em().fork().findOne(MfaOrganizationPolicy, { organizationId: TEST_ORGANIZATION_ID });
      return row ? row.enforceTotp : null;
    });

  /** A policy set while the key was there: written past the refusal. */
  const forcePolicy = async (enforceTotp: boolean) => {
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "mfa_organization_policies"
           ("id", "organization_id", "enforce_totp", "updated_by_actor", "created_at", "updated_at")
         values (gen_random_uuid(), ?, ?, 'test', now(), now())
         on conflict ("organization_id") do update set "enforce_totp" = excluded."enforce_totp"`,
        [TEST_ORGANIZATION_ID, enforceTotp],
      );
  };

  const customerLogin = async (email: string) => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email, password: STUB_CUSTOMER_PASSWORD },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { status: string } }).data.status;
  };

  beforeAll(async () => {
    savedKey = process.env['MFA_SECRET_ENCRYPTION_KEY'];
    delete process.env['MFA_SECRET_ENCRYPTION_KEY'];
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
    if (savedKey === undefined) delete process.env['MFA_SECRET_ENCRYPTION_KEY'];
    else process.env['MFA_SECRET_ENCRYPTION_KEY'] = savedKey;
  });

  // --- mfa.storefront.totp_enforced -----------------------------------------

  it('refuses turning the storefront setting on platform-wide, with a translated sentence', async () => {
    const res = await putEnforced({ scope: 'all', value: true });
    expect(res.statusCode, res.body).toBe(409);
    const error = res.json().error as { code: string; message: string; details: Record<string, unknown> };
    expect(error.code).toBe('MFA_ENFORCEMENT_UNAVAILABLE');
    expect(error.details).toMatchObject({ reason: 'encryption_key_missing', setting: ENFORCED });
    expect(error.message).toBe(SENTENCE_EN);
  });

  it('refuses turning it on for one channel', async () => {
    const res = await putEnforced({ scope: 'subset', salesChannelCodes: [CHANNEL], value: true });
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json().error as { code: string }).code).toBe('MFA_ENFORCEMENT_UNAVAILABLE');
  });

  it('always lets it be turned off', async () => {
    expect((await putEnforced({ scope: 'all', value: false })).statusCode).toBe(200);
  });

  it('says on the Settings screen that it is on and not in force, and accepts re-saving true', async () => {
    expect(await notice()).toBeUndefined();
    await forceGlobal(true);
    expect(await notice()).toEqual({
      code: 'encryption_key_missing',
      message: 'Not in force: no encryption key (MFA_SECRET_ENCRYPTION_KEY).',
    });
    expect((await putEnforced({ scope: 'all', value: true })).statusCode).toBe(200);

    // Not applied: an unenrolled customer signs in on the password.
    expect(await customerLogin(RFQ_EMAIL)).toBe('authenticated');

    expect((await putEnforced({ scope: 'all', value: false })).statusCode).toBe(200);
    expect(await notice()).toBeUndefined();
  });

  // --- the organization's policy --------------------------------------------

  it("refuses the storefront administrator's off → on write, and stores nothing", async () => {
    const res = await putOrgPolicy(true);
    expect(res.statusCode, res.body).toBe(409);
    const error = res.json().error as { code: string; details: Record<string, unknown> };
    expect(error.code).toBe('MFA_ENFORCEMENT_UNAVAILABLE');
    expect(error.details).toMatchObject({ reason: 'encryption_key_missing' });
    expect(await storedPolicy()).not.toBe(true);
  });

  it("refuses the Admin UI's off → on write the same way", async () => {
    const res = await postAdminOrgPolicy(true);
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json().error as { code: string; message: string }).message).toBe(SENTENCE_EN);
    expect(await storedPolicy()).not.toBe(true);
  });

  it('lets a policy set before the key went be lifted, from either surface', async () => {
    await forcePolicy(true);
    // Not applied meanwhile: a member signs in on the password.
    expect(await customerLogin(RFQ_EMAIL)).toBe('authenticated');
    // `true` over `true` is accepted, as any re-save is.
    expect((await putOrgPolicy(true)).statusCode).toBe(200);

    const lifted = await putOrgPolicy(false);
    expect(lifted.statusCode, lifted.body).toBe(200);
    expect(await storedPolicy()).toBe(false);

    await forcePolicy(true);
    const liftedByAdmin = await postAdminOrgPolicy(false);
    expect(liftedByAdmin.statusCode, liftedByAdmin.body).toBe(200);
    expect(await storedPolicy()).toBe(false);
  });
});
