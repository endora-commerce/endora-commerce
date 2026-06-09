import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { MfaSocialIdentity } from '../../../src/modules/mfa/entities/mfa-social-identity.entity.js';

/**
 * Feature 042 / US4 — storefront federated sign-in (Google), OIDC client faked.
 * Covers: match existing customer, auto-create standalone, unverified-email
 * refusal, and the disabled-provider gate.
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

/** Run /start → extract the opaque state → return it for a /callback. */
async function startAndGetState(h: BackendServerHandle): Promise<string> {
  const res = await h.app.inject({
    method: 'GET',
    url: '/api/v1/auth/customer/oauth/google/start',
  });
  expect(res.statusCode).toBe(302);
  const location = res.headers['location'] as string;
  return new URL(location).searchParams.get('state')!;
}

function callback(h: BackendServerHandle, code: string, state: string) {
  return h.app.inject({
    method: 'GET',
    url: `/api/v1/auth/customer/oauth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  });
}

describe('MFA US4 — customer social login', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setGoogleEnabled(h, true);
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

  it('auto-creates a standalone customer when none matches', async () => {
    const email = 'new-social-customer@example.com';
    const state = await startAndGetState(h);
    const res = await callback(h, email, state);
    expect(res.statusCode).toBe(302);
    expect(res.cookies.find((c) => c.name === 'b2b_session')?.value).toBeTruthy();

    const created = await h.em().findOne(CustomerAccount, { email });
    expect(created).not.toBeNull();
    expect(created!.organizationId ?? null).toBeNull(); // standalone (no org)
  });

  it('refuses an unverified provider email', async () => {
    const state = await startAndGetState(h);
    const res = await callback(h, 'unverified@example.com', state);
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login?error=');
    expect(res.cookies.find((c) => c.name === 'b2b_session')).toBeUndefined();
  });

  it('refuses to start when the provider is disabled', async () => {
    await setGoogleEnabled(h, false);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/customer/oauth/google/start',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login?error=');
    await setGoogleEnabled(h, true);
  });
});
