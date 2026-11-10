import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../../packages/modules/customers/src/manifest.js';
import { CustomerAccount } from '../../helpers/package-entities.js';

/**
 * Feature 040, US3 — admin block/unblock over HTTP: blocks revoke the
 * customer's session and deny login (ACCOUNT_BLOCKED); unblock restores login.
 */
describe('Admin customer block/unblock (US3)', () => {
  let h: BackendServerHandle;
  const password = 'a-very-strong-pass';

  function cookieFromResponse(setCookie: string | string[] | undefined): string {
    const raw = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie ?? '');
    const m = raw.match(/b2b_session=([^;]+)/);
    if (!m) throw new Error(`no b2b_session cookie in: ${raw}`);
    return decodeURIComponent(m[1]!);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const reconciler = new ManifestReconciler(h.em());
    await reconciler.apply([customersManifest.settings!]);
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customers.allow_registration_without_organization/value',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { scope: 'all', value: true },
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function registerCustomer(): Promise<{ id: string; email: string; cookie: string }> {
    const email = `block-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
    const reg = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: { email, password, firstName: 'Block', lastName: 'Me', acceptedTermsVersion: 'v1' },
    });
    const cookie = cookieFromResponse(reg.headers['set-cookie']);
    const account = await h.em().findOne(CustomerAccount, { email });
    return { id: account!.id, email, cookie };
  }

  it('blocks a customer: revokes session, denies login; unblock restores it', async () => {
    const c = await registerCustomer();

    // Session works before block.
    const before = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/customer',
      cookies: { b2b_session: c.cookie },
    });
    expect(before.statusCode).toBe(200);

    // Block.
    const block = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${c.id}/block`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { reason: 'abuse' },
    });
    expect(block.statusCode).toBe(200);
    expect((block.json() as { data: { blocked: boolean } }).data.blocked).toBe(true);

    // Session revoked.
    const afterBlock = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/customer',
      cookies: { b2b_session: c.cookie },
    });
    expect(afterBlock.statusCode).toBe(401);

    // Login denied with ACCOUNT_BLOCKED.
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: c.email, password },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe('ACCOUNT_BLOCKED');

    // Unblock → login restored.
    const unblock = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${c.id}/unblock`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(unblock.statusCode).toBe(200);
    expect((unblock.json() as { data: { blocked: boolean } }).data.blocked).toBe(false);

    const relogin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: c.email, password },
    });
    expect(relogin.statusCode).toBe(200);
  });

  it('leaves no e-mail, name, block reason or organization in the platform audit log (D-288, #470)', async () => {
    const c = await registerCustomer();
    const reason = `S470-REASON-${Date.now()}`;
    const block = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${c.id}/block`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { reason },
    });
    expect(block.statusCode).toBe(200);
    const account = await h.em().fork().findOneOrFail(CustomerAccount, { id: c.id });

    const read = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-log?filter[objectId]=${c.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(read.statusCode, read.body).toBe(200);
    const rows = (read.json() as { data: Array<{ action: string; stateBefore: unknown; stateAfter: unknown }> }).data;
    expect(rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['customer_account.register_standalone', 'customer_account.blocked']),
    );
    const recorded = JSON.stringify(rows.map((row) => [row.stateBefore, row.stateAfter]));
    // The names as recorded JSON strings: `Block` alone is part of a key name.
    for (const sentinel of [c.email, '"Block"', '"Me"', reason, account.organizationId]) {
      expect(recorded, sentinel).not.toContain(sentinel);
    }
    expect(rows.find((row) => row.action === 'customer_account.blocked')?.stateAfter).toMatchObject({
      blockSource: 'staff',
      hasBlockReason: true,
    });
  });

  it('returns 404 for an unknown customer', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/customers/00000000-0000-4000-8000-0000000000fe/block',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires an admin session', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/customers/00000000-0000-4000-8000-0000000000fe/block',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});
