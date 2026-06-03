import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/modules/settings/services/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../src/modules/customers/manifest.js';

/**
 * A failed customer login must surface a distinct, actionable error — not the
 * generic `UNAUTHORIZED` / "Authentication is required." guard string (which
 * the storefront cannot turn into a helpful "wrong password, try again"
 * message). Regression for the storefront blank-login-page report.
 */
describe('Customer login — invalid credentials', () => {
  let h: BackendServerHandle;
  const password = 'a-very-strong-pass';

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
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  async function register(): Promise<string> {
    const email = `login-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: { email, password, firstName: 'Log', lastName: 'In', acceptedTermsVersion: 'v1' },
    });
    return email;
  }

  it('returns 401 INVALID_CREDENTIALS with a friendly message for a wrong password', async () => {
    const email = await register();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email, password: 'totally-wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
    expect(body.error.message).toMatch(/invalid email or password/i);
    // The generic guard string must NOT leak through.
    expect(body.error.message).not.toMatch(/authentication is required/i);
  });

  it('returns 401 INVALID_CREDENTIALS for an unknown email (no account enumeration)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: `missing-${Date.now()}@example.test`, password },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('still logs in successfully with the correct password', async () => {
    const email = await register();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email, password },
    });
    expect(res.statusCode).toBe(200);
  });
});
