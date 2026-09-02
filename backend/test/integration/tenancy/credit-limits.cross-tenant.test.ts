import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminRole, AdminUser, Organization, OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * Feature 050 US1 — the tenant guard confines the credit_limits admin surface.
 *
 * A sales-rep admin granted `credit_limits:manage` and assigned to Org A only
 * MUST NOT see or mutate Org B's credit limit, even though `credit_limits`
 * historically trusted the permission alone with the target org from a URL param
 * (unfiltered `listAll()` + param-driven grant/adjust). A platform admin is
 * unaffected. This test fails on `master` (pre-guard) and passes once CreditLimit
 * is classified `@OrgScoped` and the grant/adjust route gates on org membership.
 */
describe('Credit limits — cross-tenant scoping (feature 050 US1)', () => {
  let h: BackendServerHandle;
  let repCookie: string;
  let orgAId: string;
  let orgBId: string;

  const makeOrg = (label: string) =>
    ({
      name: `050 ${label} Org`,
      taxId: `PL050${label}${Date.now().toString().slice(-7)}`,
      status: 'active' as const,
      vatStatus: 'vat_payer' as const,
      registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    let role = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (!role) {
      role = em.create(AdminRole, {
        code: 'sales_representative',
        name: 'Sales Representative',
        permissions: ['credit_limits:manage'],
      });
    } else if (!role.permissions.includes('credit_limits:manage')) {
      role.permissions = [...role.permissions, 'credit_limits:manage'];
    }
    await em.persistAndFlush(role);

    const rep = em.create(AdminUser, {
      email: `sales-rep-050-${Date.now()}@cl.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: '050',
      lastName: 'Rep',
    });
    await em.persistAndFlush(rep);

    const orgA = em.create(Organization, makeOrg('A'));
    const orgB = em.create(Organization, makeOrg('B'));
    await em.persistAndFlush([orgA, orgB]);
    orgAId = orgA.id;
    orgBId = orgB.id;

    await em.persistAndFlush(
      em.create(OrganizationSalesRepAssignment, { organizationId: orgA.id, adminUserId: rep.id }),
    );

    repCookie = `stub-sales-rep-050-${Date.now()}`;
    ADMIN_COOKIES[repCookie] = { adminUserId: rep.id };

    // Platform admin grants a credit limit to BOTH orgs.
    for (const id of [orgAId, orgBId]) {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${id}/credit-limit`,
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { grantedAmount: 5000, currency: 'PLN' },
      });
      expect(res.statusCode).toBe(201);
    }
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[repCookie];
    await teardownBackendServer(h);
  });

  it('scoped sales-rep list shows only their assigned org, never all', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/credit-limits',
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ organizationId: string }> };
    const orgIds = body.data.map((r) => r.organizationId);
    expect(orgIds).toContain(orgAId);
    expect(orgIds).not.toContain(orgBId);
  });

  it('scoped sales-rep cannot grant/adjust a credit limit for an unassigned org', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgBId}/credit-limit`,
      cookies: { b2b_session: repCookie },
      payload: { grantedAmount: 9999, currency: 'PLN' },
    });
    expect(res.statusCode).toBe(404);

    // And nothing was persisted for Org B by the rep — platform admin still sees 5000.
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/credit-limits',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = list.json() as { data: Array<{ organizationId: string; grantedAmount: number }> };
    const rowB = body.data.find((r) => r.organizationId === orgBId);
    expect(rowB?.grantedAmount).toBe(5000);
  });

  it('scoped sales-rep can adjust within their assigned org', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgAId}/credit-limit`,
      cookies: { b2b_session: repCookie },
      payload: { grantedAmount: 7000 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('platform admin still sees every organization (unchanged)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/credit-limits',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ organizationId: string }> };
    const orgIds = body.data.map((r) => r.organizationId);
    expect(orgIds).toContain(orgAId);
    expect(orgIds).toContain(orgBId);
  });
});
