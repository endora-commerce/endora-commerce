import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../../packages/modules/customers/src/manifest.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { ERROR_CODES } from '@endora-commerce/contracts';

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
    await teardownBackendServer(h);
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

  it('returns 404 CUSTOMER_NOT_FOUND for an unknown customer', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/customers/00000000-0000-4000-8000-0000000000fd/impersonate',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.CUSTOMER_NOT_FOUND);
  });

  async function softDeletedCustomer(): Promise<string> {
    const customerId = await registerOrgLessCustomer();
    const em = h.em();
    const account = await em.findOneOrFail(CustomerAccount, { id: customerId });
    account.deletedAt = new Date();
    await em.flush();
    return customerId;
  }

  // Issue #814 — a soft-deleted customer is refused with the record's own code,
  // not the generic `NOT_FOUND`, and the refusal mints and audits nothing.
  it('refuses a soft-deleted customer with 409 CUSTOMER_ALREADY_DELETED, minting no session', async () => {
    const customerId = await softDeletedCustomer();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customerId}/impersonate`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.CUSTOMER_ALREADY_DELETED,
    );
    expect(String(res.headers['set-cookie'] ?? '')).not.toContain('admin_shadow_session=');
    expect(
      await h.em().count(AuditLogEntry, {
        action: 'impersonation.start',
        impersonatedCustomerAccountId: customerId,
      }),
    ).toBe(0);
  });

  it('answers a caller without the permission the same 403 whatever the target', async () => {
    const deleted = await softDeletedCustomer();
    const active = await registerOrgLessCustomer();
    const answers: Array<[number, string]> = [];
    for (const id of [active, deleted, '00000000-0000-4000-8000-0000000000fd']) {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/customers/${id}/impersonate`,
        cookies: { b2b_session: 'stub-restricted-admin-session' },
        payload: {},
      });
      answers.push([res.statusCode, (res.json() as { error: { code: string } }).error.code]);
    }
    expect(answers[0]![0]).toBe(403);
    expect(answers).toEqual([answers[0], answers[0], answers[0]]);
  });
});
