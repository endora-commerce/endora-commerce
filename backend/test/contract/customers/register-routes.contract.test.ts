import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../../packages/modules/customers/src/manifest.js';

/**
 * Feature 040, US1 — contract test for POST /api/v1/customers/register.
 *
 * The setting is enabled once in `beforeAll`, so the first read is a fresh
 * cache miss (no cross-call cache pollution). The refusal path (403 when the
 * setting is off) is covered by the service-level integration test
 * `customer-registration-service.test.ts`.
 */
describe('POST /api/v1/customers/register (US1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Seed the customers module settings, then enable standalone registration.
    const reconciler = new ManifestReconciler(h.em());
    await reconciler.apply([customersManifest.settings!]);
    const r = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customers.allow_registration_without_organization/value',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { scope: 'all', value: true },
    });
    if (r.statusCode !== 200) {
      throw new Error(`enable registration failed: ${r.statusCode} ${r.body}`);
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const validBody = (email: string) => ({
    email,
    password: 'a-very-strong-pass',
    firstName: 'Stand',
    lastName: 'Alone',
    acceptedTermsVersion: 'v1',
  });

  it('creates a personal-org-backed account and sets a session cookie when enabled', async () => {
    const email = `ok-${Date.now()}@example.test`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: validBody(email),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: { customerAccount: { email: string; organizationId: string | null } };
    };
    expect(body.data.customerAccount.email).toBe(email);
    // Feature 051 — standalone registration provisions a personal organization,
    // so the account is always linked to a (non-null) org.
    expect(body.data.customerAccount.organizationId).toEqual(expect.any(String));
    // Auto-login: a b2b_session cookie is set.
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
    expect(cookieStr).toContain('b2b_session=');
  });

  it('refuses a duplicate email with 409 EMAIL_ALREADY_REGISTERED', async () => {
    const email = `dupe-${Date.now()}@example.test`;
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: validBody(email),
    });
    expect(first.statusCode).toBe(201);
    const second = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: validBody(email),
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rejects an invalid email with 400', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: { ...validBody('x'), email: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });
});
