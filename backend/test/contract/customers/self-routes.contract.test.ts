import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/modules/settings/services/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../src/modules/customers/manifest.js';

/**
 * Feature 040, US1 — contract test for the customer self-service routes.
 * Uses a freshly-registered org-less customer (isolated; also exercises the
 * FR-003 org-less paths).
 */
describe('Customer self-service routes (US1)', () => {
  let h: BackendServerHandle;
  let sessionCookie: string;
  const password = 'a-very-strong-pass';
  let email: string;

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
    const enable = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customers.allow_registration_without_organization/value',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { scope: 'all', value: true },
    });
    if (enable.statusCode !== 200) {
      throw new Error(`enable registration failed: ${enable.statusCode} ${enable.body}`);
    }
    email = `self-${Date.now()}@example.test`;
    const reg = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: { email, password, firstName: 'Self', lastName: 'Serve', acceptedTermsVersion: 'v1' },
    });
    if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.statusCode} ${reg.body}`);
    sessionCookie = cookieFromResponse(reg.headers['set-cookie']);
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  it('GET /api/v1/me/customer returns the org-less profile', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/customer',
      cookies: { b2b_session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { email: string; organizationId: string | null; twoFactorEnabled: boolean };
    };
    expect(body.data.email).toBe(email);
    expect(body.data.organizationId).toBeNull();
    expect(body.data.twoFactorEnabled).toBe(false);
  });

  it('GET /api/v1/me/customer requires a customer session', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/me/customer' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/v1/me/customer/orders returns an (empty) paginated list', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/customer/orders',
      cookies: { b2b_session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; meta: { total: number } };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.total).toBe(0);
  });

  it('GET /api/v1/me/customer/quote-requests returns [] for an org-less customer', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/customer/quote-requests',
      cookies: { b2b_session: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it('change-password rejects a wrong current password, accepts the correct one', async () => {
    const wrong = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/customer/change-password',
      cookies: { b2b_session: sessionCookie },
      payload: { currentPassword: 'totally-wrong-pass', newPassword: 'brand-new-strong-pass' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('CURRENT_PASSWORD_INVALID');

    const ok = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/customer/change-password',
      cookies: { b2b_session: sessionCookie },
      payload: { currentPassword: password, newPassword: 'brand-new-strong-pass' },
    });
    expect(ok.statusCode).toBe(204);

    // The new password is now the current one (old no longer works).
    const reuseOld = await h.app.inject({
      method: 'POST',
      url: '/api/v1/me/customer/change-password',
      cookies: { b2b_session: sessionCookie },
      payload: { currentPassword: password, newPassword: 'yet-another-strong-pass' },
    });
    expect(reuseOld.statusCode).toBe(401);
  });
});
