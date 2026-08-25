import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { MfaSocialIdentity } from '../../helpers/package-entities.js';

/**
 * Feature 042 / US4 — storefront federated sign-in (Google), OIDC client faked.
 * Covers: match existing customer, auto-create standalone, the org-less
 * registration gate, unverified-email refusal, and the disabled-provider gate.
 *
 * The registration gate is asserted here for the first time (feature 072,
 * T143a cluster 6). Auto-creation has always been gated on
 * `customers.allow_registration_without_organization` in production and on
 * nothing at all in the test harness, because each composition root wrote its
 * own `autoCreateCustomer` closure over `customer_accounts`' table. One
 * implementation serves both now — the module's — so this suite has to say
 * which side of the gate it is testing, and it can finally test the other one.
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

/** The B2C gate. Ships **off**, so a suite that wants an auto-create says so. */
async function setStandaloneRegistrationAllowed(
  h: BackendServerHandle,
  allowed: boolean,
): Promise<void> {
  await h.settings.adminService.setValueForAllChannels(
    'customers.allow_registration_without_organization',
    allowed,
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
    await setStandaloneRegistrationAllowed(h, true);
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

    // Issue #122 — the other way an account appears without an admin
    // (`customers`' standalone self-registration) has always recorded an entry
    // with a null actor; this path recorded nothing, because the coverage scan
    // never opened a `backend.ts`. An account arriving out of a federated
    // sign-in is exactly what an operator later has to be able to explain.
    const audit = await h
      .em()
      .find(AuditLogEntry, {
        action: 'customer_account.register_social',
        objectId: created!.id,
      });
    expect(audit).toHaveLength(1);
    expect((audit[0]!.stateAfter as { email?: string } | null)?.email).toBe(email);
  });

  it('refuses to auto-create while org-less registration is off', async () => {
    await setStandaloneRegistrationAllowed(h, false);
    const email = 'refused-social-customer@example.com';
    const state = await startAndGetState(h);
    const res = await callback(h, email, state);

    // `registration_required` — no session, and no account behind it.
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/login?error=');
    expect(res.cookies.find((c) => c.name === 'b2b_session')).toBeUndefined();
    expect(await h.em().findOne(CustomerAccount, { email })).toBeNull();

    await setStandaloneRegistrationAllowed(h, true);
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
