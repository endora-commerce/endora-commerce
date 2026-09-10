import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

/**
 * Feature 042 / US6 — Platform Administrator resets a customer's 2FA, single
 * and organization-wide, with audit coverage and permission gating.
 */
const CUSTOMER_COOKIE = { b2b_session: 'stub-customer-session' };
const PLATFORM_ADMIN = { b2b_admin_session: 'stub-admin-session' };
const RESTRICTED_ADMIN = { b2b_admin_session: 'stub-restricted-admin-session' };

function totpCode(secret: string): string {
  return new TOTP({
    issuer: 'B2B Platform',
    label: 'verify',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function enrolTestCustomer(h: BackendServerHandle): Promise<void> {
  const setup = await h.app.inject({
    method: 'POST',
    url: '/api/v1/account/mfa/setup',
    cookies: CUSTOMER_COOKIE,
  });
  const { secret } = setup.json().data as { secret: string };
  await h.app.inject({
    method: 'POST',
    url: '/api/v1/account/mfa/activate',
    cookies: CUSTOMER_COOKIE,
    payload: { code: totpCode(secret) },
  });
}

async function isActive(h: BackendServerHandle): Promise<boolean> {
  const res = await h.app.inject({
    method: 'GET',
    url: '/api/v1/account/mfa/status',
    cookies: CUSTOMER_COOKIE,
  });
  return res.json().data.totpActive as boolean;
}

describe('MFA US6 — platform-admin reset', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.settings.adminService.setValueForAllChannels(
      'mfa.storefront.totp_enabled',
      true,
      null,
      { actorAdminUserId: null },
    );
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('resets a single account and audits it', async () => {
    await enrolTestCustomer(h);
    expect(await isActive(h)).toBe(true);

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${TEST_CUSTOMER_ID}/mfa/reset`,
      cookies: PLATFORM_ADMIN,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.affected).toBe(true);
    expect(await isActive(h)).toBe(false);

    const entries = await h
      .em()
      .find(AuditLogEntry, { action: 'mfa.reset', objectId: TEST_CUSTOMER_ID });
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it('resets everyone in an organization and reports a summary', async () => {
    await enrolTestCustomer(h);
    expect(await isActive(h)).toBe(true);

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/mfa/reset-bulk',
      cookies: PLATFORM_ADMIN,
      payload: { organizationId: TEST_ORGANIZATION_ID },
    });
    expect(res.statusCode).toBe(200);
    const summary = res.json().data as { requested: number; affected: number; skipped: number };
    expect(summary.affected).toBeGreaterThanOrEqual(1);
    expect(summary.requested).toBe(summary.affected + summary.skipped);
    expect(await isActive(h)).toBe(false);

    const bulkRows = await h.em().find(AuditLogEntry, { action: 'mfa.reset_bulk' });
    expect(bulkRows.length).toBeGreaterThanOrEqual(1);
  });

  it('reports affected=false when the account had no 2FA', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${TEST_CUSTOMER_ID}/mfa/reset`,
      cookies: PLATFORM_ADMIN,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.affected).toBe(false);
  });

  it('refuses reset for an admin without the mfa:reset permission', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${TEST_CUSTOMER_ID}/mfa/reset`,
      cookies: RESTRICTED_ADMIN,
    });
    expect(res.statusCode).toBe(403);
  });
});
