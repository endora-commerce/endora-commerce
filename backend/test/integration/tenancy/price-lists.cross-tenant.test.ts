import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminRole, AdminUser, Organization, OrganizationSalesRepAssignment } from '../../helpers/package-entities.js';
import { randomUUID } from 'crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Feature 050 US1 — price_lists is rule-scoped: org targeting lives in the
 * applicationRule, not a column. A sales-rep assigned to Org A sees a price list
 * that targets Org B neither in the list nor by id; global (untargeted) lists
 * and Org-A-targeted lists remain visible. Platform admin sees everything.
 *
 * The sales-rep fixture holds `price_lists:read` since issue #219; it used to
 * hold `catalog:write`, which was how these routes were gated then. The subject
 * of the test is the org scoping, not the code — the rep needs whatever code
 * opens the pricing list surface.
 */
describe('Price lists — cross-tenant scoping (feature 050 US1)', () => {
  let h: BackendServerHandle;
  let repCookie: string;
  const orgAId = randomUUID();
  const orgBId = randomUUID();
  let listAId: string;
  let listBId: string;

  const createList = async (name: string, orgId: string): Promise<string> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/price-lists-engine',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        name,
        type: 'sale',
        applicationRule: { kind: 'criterion', type: 'organization', values: [orgId] },
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('test seed', async () => {
      const em = h.em();
      // Real orgs — the create endpoint validates that targeted org ids exist.
      for (const [id, label] of [[orgAId, 'A'], [orgBId, 'B']] as const) {
        em.create(Organization, {
          id,
          name: `050 PL ${label}`,
          taxId: `PL050PL${label}${Date.now().toString().slice(-7)}`,
          status: 'active',
          vatStatus: 'vat_payer',
          registeredAddress: { street: 'ul. Cenowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
        });
      }
      await em.flush();
      let role = await em.findOne(AdminRole, { code: 'sales_representative' });
      if (!role) {
        role = em.create(AdminRole, {
          code: 'sales_representative',
          name: 'Sales Representative',
          permissions: ['price_lists:read'],
        });
      } else if (!role.permissions.includes('price_lists:read')) {
        role.permissions = [...role.permissions, 'price_lists:read'];
      }
      await em.persistAndFlush(role);
      const rep = em.create(AdminUser, {
        email: `sales-rep-050-pl-${Date.now()}@p.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: '050',
        lastName: 'Rep',
      });
      await em.persistAndFlush(rep);
      await em.persistAndFlush(
        em.create(OrganizationSalesRepAssignment, { organizationId: orgAId, adminUserId: rep.id }),
      );
      repCookie = `stub-sales-rep-050-pl-${Date.now()}`;
      ADMIN_COOKIES[repCookie] = { adminUserId: rep.id };
    });

    listAId = await createList('List A (org A)', orgAId);
    listBId = await createList('List B (org B)', orgBId);
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[repCookie];
    await teardownBackendServer(h);
  });

  it('scoped sales-rep list excludes lists targeting only unassigned orgs', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/price-lists-engine',
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { data: { items: Array<{ id: string }> } }).data.items.map((r) => r.id);
    expect(ids).toContain(listAId);
    expect(ids).not.toContain(listBId);
  });

  it('scoped sales-rep cannot view an unassigned-org price list (404)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/price-lists-engine/${listBId}`,
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('scoped sales-rep can view an assigned-org price list', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/price-lists-engine/${listAId}`,
      cookies: { b2b_session: repCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it('platform admin sees both org-targeted lists', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/price-lists-engine',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const ids = (res.json() as { data: { items: Array<{ id: string }> } }).data.items.map((r) => r.id);
    expect(ids).toContain(listAId);
    expect(ids).toContain(listBId);
  });
});
