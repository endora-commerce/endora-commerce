import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../src/modules/customers/manifest.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';

/**
 * Feature 040, US4 — admin impersonation of an org-less customer: mints a
 * storefront impersonation session, audits the start, and the minted session
 * resolves to the impersonated customer.
 */
describe('Admin customer impersonation (US4)', () => {
  let h: BackendServerHandle;

  function cookieFromResponse(
    setCookie: string | string[] | undefined,
    name: string,
  ): string {
    const raw = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie ?? '');
    const m = raw.match(new RegExp(`${name}=([^;]+)`));
    if (!m) throw new Error(`no ${name} cookie in: ${raw}`);
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
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  async function registerOrgLessCustomer(): Promise<string> {
    const email = `imp-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: { email, password: 'a-very-strong-pass', firstName: 'Imp', lastName: 'Target', acceptedTermsVersion: 'v1' },
    });
    const account = await h.em().findOne(CustomerAccount, { email });
    return account!.id;
  }

  it('impersonates an org-less customer, audits start, and the session resolves to them', async () => {
    const customerId = await registerOrgLessCustomer();

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customerId}/impersonate`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { reason: 'support ticket #42' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { impersonatedCustomerAccount: { id: string } } };
    expect(body.data.impersonatedCustomerAccount.id).toBe(customerId);

    // The minted session cookie resolves to the impersonated customer.
    const impersonationCookie = cookieFromResponse(res.headers['set-cookie'], 'b2b_session');
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/customer',
      cookies: { b2b_session: impersonationCookie },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { data: { id: string } }).data.id).toBe(customerId);

    // An admin shadow cookie is issued so impersonation can be ended.
    expect(String(res.headers['set-cookie'])).toContain('admin_shadow_session=');

    // Audit: impersonation.start recorded for this customer.
    const entries = await h.em().find(AuditLogEntry, {
      action: 'impersonation.start',
      impersonatedCustomerAccountId: customerId,
    });
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it('requires an admin session', async () => {
    const customerId = await registerOrgLessCustomer();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customerId}/impersonate`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown customer', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/customers/00000000-0000-4000-8000-0000000000fd/impersonate',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
