import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../src/modules/customers/manifest.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';

/**
 * Feature 040, US5 — admin customer list + detail.
 */
describe('Admin customer list + detail (US5)', () => {
  let h: BackendServerHandle;
  let customerId: string;
  let email: string;

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
    email = `list-${Date.now()}@example.test`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: { email, password: 'a-very-strong-pass', firstName: 'List', lastName: 'Me', acceptedTermsVersion: 'v1' },
    });
    customerId = (await h.em().findOne(CustomerAccount, { email }))!.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists customers and finds the registered one by search', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/customers?q=${encodeURIComponent(email)}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; email: string }>; meta: { total: number } };
    expect(body.data.some((c) => c.id === customerId)).toBe(true);
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('returns full detail with the five info fields, null block, and defaults', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/customers/${customerId}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const d = (res.json() as { data: Record<string, unknown> }).data;
    expect(d.id).toBe(customerId);
    expect(d.email).toBe(email);
    expect(d).toHaveProperty('createdAt');
    expect(d).toHaveProperty('customerGroupId', null);
    // Feature 051 — registered standalone customers are backed by a personal org.
    expect(d.organizationId).toEqual(expect.any(String));
    expect(d).toHaveProperty('blocked', false);
    expect(d).toHaveProperty('lastLoginAt');
    expect(d.block).toBeNull();
    expect(d.deletion).toBeNull();
    expect(d.salesChannelIds).toEqual([]);
    expect(d.defaults).toMatchObject({ paymentMethodId: null, billingAddressId: null });
  });

  it('returns 404 for an unknown customer', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/customers/00000000-0000-4000-8000-0000000000fc',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires an admin session', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/customers' });
    expect(res.statusCode).toBe(401);
  });
});
