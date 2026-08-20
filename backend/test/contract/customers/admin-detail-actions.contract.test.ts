import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../src/modules/customers/manifest.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 040, US5 — admin customer-detail actions: org assign/unassign,
 * addresses, NIP/VAT validate, and the read-only history panels.
 */
describe('Admin customer detail actions (US5)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    const reconciler = new ManifestReconciler(h.em());
    await reconciler.apply([customersManifest.settings!]);
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customers.allow_registration_without_organization/value',
      cookies: admin,
      payload: { scope: 'all', value: true },
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function newCustomer(): Promise<string> {
    const email = `det-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: { email, password: 'a-very-strong-pass', firstName: 'Det', lastName: 'Act', acceptedTermsVersion: 'v1' },
    });
    return (await h.em().findOne(CustomerAccount, { email }))!.id;
  }

  it('assigns and unassigns an organization', async () => {
    const id = await newCustomer();
    const assign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${id}/organization`,
      cookies: admin,
      payload: { organizationId: TEST_ORGANIZATION_ID },
    });
    expect(assign.statusCode).toBe(200);
    expect((assign.json() as { data: { organizationId: string | null } }).data.organizationId).toBe(TEST_ORGANIZATION_ID);

    const unassign = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/customers/${id}/organization`,
      cookies: admin,
    });
    expect(unassign.statusCode).toBe(200);
    expect((unassign.json() as { data: { organizationId: string | null } }).data.organizationId).toBeNull();
  });

  it('adds and lists addresses for the customer', async () => {
    const id = await newCustomer();
    const create = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${id}/addresses`,
      cookies: admin,
      payload: { kind: 'delivery', recipientName: 'Jan', street: 'ul. 1', city: 'Wwa', postalCode: '00-001', country: 'PL' },
    });
    expect(create.statusCode).toBe(201);
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/customers/${id}/addresses`,
      cookies: admin,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: { personal: unknown[] } }).data.personal).toHaveLength(1);
  });

  it('validates a NIP/VAT number', async () => {
    const id = await newCustomer();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${id}/vat-validate`,
      cookies: admin,
      payload: { taxId: 'PL0000000099', countryCode: 'PL' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { outcome: string } }).data.outcome).toBe('validated');
  });

  it('returns read-only orders / quote-requests / carts panels', async () => {
    const id = await newCustomer();
    const orders = await h.app.inject({ method: 'GET', url: `/api/v1/admin/customers/${id}/orders`, cookies: admin });
    expect(orders.statusCode).toBe(200);
    expect((orders.json() as { data: unknown[] }).data).toEqual([]);

    const rfqs = await h.app.inject({ method: 'GET', url: `/api/v1/admin/customers/${id}/quote-requests`, cookies: admin });
    expect(rfqs.statusCode).toBe(200);
    expect((rfqs.json() as { data: unknown[] }).data).toEqual([]);

    const carts = await h.app.inject({ method: 'GET', url: `/api/v1/admin/customers/${id}/carts`, cookies: admin });
    expect(carts.statusCode).toBe(200);
    expect((carts.json() as { data: { current: unknown; abandoned: unknown[] } }).data).toMatchObject({
      current: null,
      abandoned: [],
    });
  });
});
