import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import {
  TEST_CUSTOMER_ID,
  TEST_CUSTOMER_RFQ_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';

/**
 * `twoFactorEnabled` is the live `mfa` enrolment, on every surface that
 * publishes it — the repair of the deferred-defect entry "`twoFactorEnabled`
 * is a constant `false` on six API responses and two admin screens".
 *
 * Before this test the field was derived from `two_factor_confirmed_at`, a
 * column with no writer on either identity table, so it was **provably
 * constant `false`** — including on the buyer's own account page, which reads
 * `GET /api/v1/me/customer` and rendered "Two-factor: Disabled" to a customer
 * who had enrolled through `mfa` an hour earlier.
 *
 * Both halves are proved here, because only one of them was ever the bug: an
 * enrolled subject reads `true` at every site, and an unenrolled one still
 * reads `false`. A repair that answered `true` for everybody would be a worse
 * defect in the direction that actually matters, and a positive-only test
 * cannot tell the two apart.
 *
 * The absence half drives the real seam (`withModuleOff`), not a stubbed
 * throw: `mfa` is deactivatable, so what an operator can actually create is a
 * platform on which these five surfaces must keep answering.
 */
const CUSTOMER_COOKIE = { b2b_session: 'stub-customer-session' };
const ADMIN_COOKIE = { b2b_admin_session: 'stub-admin-session' };

function totpCode(secretBase32: string): string {
  const totp = new TOTP({
    issuer: 'B2B Platform',
    label: 'verify',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });
  return totp.generate({ timestamp: Date.now() });
}

async function buyerSelfTwoFactor(h: BackendServerHandle): Promise<boolean> {
  const res = await h.app.inject({
    method: 'GET',
    url: '/api/v1/me/customer',
    cookies: CUSTOMER_COOKIE,
  });
  expect(res.statusCode).toBe(200);
  return res.json().data.twoFactorEnabled as boolean;
}

async function adminSelfTwoFactor(h: BackendServerHandle): Promise<boolean> {
  const res = await h.app.inject({
    method: 'GET',
    url: '/api/v1/admin/me',
    cookies: ADMIN_COOKIE,
  });
  expect(res.statusCode).toBe(200);
  return res.json().data.adminUser.twoFactorEnabled as boolean;
}

async function adminListTwoFactor(h: BackendServerHandle): Promise<Map<string, boolean>> {
  const res = await h.app.inject({
    method: 'GET',
    url: '/api/v1/admin/admin-users',
    cookies: ADMIN_COOKIE,
  });
  expect(res.statusCode).toBe(200);
  const rows = res.json().data as Array<{ id: string; twoFactorEnabled: boolean }>;
  return new Map(rows.map((r) => [r.id, r.twoFactorEnabled]));
}

async function adminCustomerDetailTwoFactor(
  h: BackendServerHandle,
  customerId: string,
): Promise<boolean> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/admin/customers/${customerId}`,
    cookies: ADMIN_COOKIE,
  });
  expect(res.statusCode).toBe(200);
  return res.json().data.twoFactorEnabled as boolean;
}

async function organizationMembersTwoFactor(
  h: BackendServerHandle,
): Promise<Map<string, boolean>> {
  const res = await h.app.inject({
    method: 'GET',
    url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}`,
    cookies: ADMIN_COOKIE,
  });
  expect(res.statusCode).toBe(200);
  const members = res.json().data.members as Array<{ id: string; twoFactorEnabled: boolean }>;
  return new Map(members.map((m) => [m.id, m.twoFactorEnabled]));
}

describe('twoFactorEnabled is the live mfa enrolment', () => {
  let h: BackendServerHandle;
  let adminUserId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.settings.adminService.setValueForAllChannels(
      'mfa.storefront.totp_enabled',
      true,
      null,
      { actorAdminUserId: null },
    );
    await h.settings.adminService.setValueForAllChannels(
      'mfa.admin.totp_enabled',
      true,
      null,
      { actorAdminUserId: null },
    );
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      cookies: ADMIN_COOKIE,
    });
    adminUserId = me.json().data.adminUser.id as string;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reads false everywhere while nobody is enrolled', async () => {
    expect(await buyerSelfTwoFactor(h)).toBe(false);
    expect(await adminSelfTwoFactor(h)).toBe(false);
    expect((await adminListTwoFactor(h)).get(adminUserId)).toBe(false);
    expect(await adminCustomerDetailTwoFactor(h, TEST_CUSTOMER_ID)).toBe(false);
    expect((await organizationMembersTwoFactor(h)).get(TEST_CUSTOMER_ID)).toBe(false);
  });

  it('follows a customer enrolment onto the buyer and admin surfaces', async () => {
    const setup = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/setup',
      cookies: CUSTOMER_COOKIE,
    });
    expect(setup.statusCode).toBe(200);
    const { secret } = setup.json().data as { secret: string };
    const activate = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/activate',
      cookies: CUSTOMER_COOKIE,
      payload: { code: totpCode(secret) },
    });
    expect(activate.statusCode).toBe(200);

    // The buyer's own account page — the surface the deferral missed.
    expect(await buyerSelfTwoFactor(h)).toBe(true);
    // The two admin-side reads of the same customer.
    expect(await adminCustomerDetailTwoFactor(h, TEST_CUSTOMER_ID)).toBe(true);
    expect((await organizationMembersTwoFactor(h)).get(TEST_CUSTOMER_ID)).toBe(true);

    // …and the customer who never enrolled still reads false, on both.
    expect(await adminCustomerDetailTwoFactor(h, TEST_CUSTOMER_RFQ_ID)).toBe(false);
    expect((await organizationMembersTwoFactor(h)).get(TEST_CUSTOMER_RFQ_ID)).toBe(false);
  });

  it('follows an admin enrolment onto the admin surfaces', async () => {
    const setup = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/account/mfa/setup',
      cookies: ADMIN_COOKIE,
    });
    expect(setup.statusCode).toBe(200);
    const { secret } = setup.json().data as { secret: string };
    const activate = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/account/mfa/activate',
      cookies: ADMIN_COOKIE,
      payload: { code: totpCode(secret) },
    });
    expect(activate.statusCode).toBe(200);

    expect(await adminSelfTwoFactor(h)).toBe(true);
    expect((await adminListTwoFactor(h)).get(adminUserId)).toBe(true);
  });

  it('answers false — not 503 — on every surface while mfa is switched off', async () => {
    await withModuleOff('mfa', 'deactivated', async () => {
      expect(await buyerSelfTwoFactor(h)).toBe(false);
      expect(await adminSelfTwoFactor(h)).toBe(false);
      expect((await adminListTwoFactor(h)).get(adminUserId)).toBe(false);
      expect(await adminCustomerDetailTwoFactor(h, TEST_CUSTOMER_ID)).toBe(false);
      expect((await organizationMembersTwoFactor(h)).get(TEST_CUSTOMER_ID)).toBe(false);
    });

    // Non-destructive and reversible: the enrolments were never touched.
    expect(await buyerSelfTwoFactor(h)).toBe(true);
    expect(await adminSelfTwoFactor(h)).toBe(true);
  });
});
