import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerAccount } from '../../helpers/package-entities.js';

/**
 * Feature 042 / US5 — admin federated sign-in (Microsoft), OIDC client faked.
 * Admin sign-in matches an existing admin user only — never auto-creates — and
 * resolution never crosses surfaces.
 */
const ADMIN_EMAIL = 'platform-admin@example.com';

async function setAdminMsEnabled(h: BackendServerHandle, enabled: boolean): Promise<void> {
  await h.settings.adminService.setValueForAllChannels(
    'mfa.admin.microsoft_enabled',
    enabled,
    null,
    { actorAdminUserId: null },
  );
}

async function startAndGetState(h: BackendServerHandle): Promise<string> {
  const res = await h.app.inject({
    method: 'GET',
    url: '/api/v1/auth/admin/oauth/microsoft/start',
  });
  expect(res.statusCode).toBe(302);
  const location = res.headers['location'] as string;
  expect(location, `start redirected to: ${location}`).toContain('oauth.test');
  return new URL(location).searchParams.get('state')!;
}

function callback(h: BackendServerHandle, code: string, state: string) {
  return h.app.inject({
    method: 'GET',
    url: `/api/v1/auth/admin/oauth/microsoft/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  });
}

describe('MFA US5 — admin social login', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setAdminMsEnabled(h, true);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('signs into an existing admin user matched by verified email', async () => {
    const state = await startAndGetState(h);
    const res = await callback(h, ADMIN_EMAIL, state);
    expect(res.statusCode).toBe(302);
    expect(
      res.cookies.find((c) => c.name === 'b2b_admin_session')?.value,
      `location=${res.headers['location']}`,
    ).toBeTruthy();
    expect(res.headers['location']).toContain('http://localhost:3002');
  });

  it('refuses an unknown email and never creates an admin account', async () => {
    const email = 'nobody-admin@example.com';
    const state = await startAndGetState(h);
    const res = await callback(h, email, state);
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login?error=');
    expect(res.cookies.find((c) => c.name === 'b2b_admin_session')).toBeUndefined();
    // And no customer was created either (admin surface never auto-creates).
    const stray = await h.em().findOne(CustomerAccount, { email });
    expect(stray).toBeNull();
  });

  it('does not match a customer email on the admin surface (no cross-surface)', async () => {
    // stub-customer@example.com is a customer, not an admin user.
    const state = await startAndGetState(h);
    const res = await callback(h, 'stub-customer@example.com', state);
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login?error=');
    expect(res.cookies.find((c) => c.name === 'b2b_admin_session')).toBeUndefined();
  });
});
