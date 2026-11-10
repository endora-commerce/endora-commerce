import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  AdminRole,
  AdminUser,
  CustomerAccount,
  Organization,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { bindOrganizationToDefaultChannel } from '../../helpers/sales-channel-access.js';
import { searchIds } from '../../helpers/admin-search-fixtures.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Issue #305 — one sales-representative reach rule, on every surface.
 *
 * Owner ruling 2026-11-07 (confirmed 2026-11-08, E-305-1): the rule is
 * `SalesRepAssignmentPort.canSeeOrganization` — assigned, roll-up, and the
 * unassigned fallback — and it applies everywhere: the Organization screens,
 * the Organization list, admin search, and every tenant-filtered read (members,
 * customers, quote requests, customer-level settings). Personal (B2C)
 * organizations are unassigned by construction, so every representative
 * reaches them too.
 *
 * Before #305 the surfaces split: the Organization screens answered by the
 * fallback, the tenant filter by the assigned set only, so an unassigned
 * Organization opened on its screen and 404'd on its members and requests,
 * while the list showed another representative's Organization a row of which
 * then opened a 404.
 *
 * Seed, for representative A:
 *  - O1 assigned to A;
 *  - U assigned to nobody;
 *  - P a personal organization;
 *  - F assigned to representative B, and Fc an unassigned child of F.
 */
describe('#305 — one sales-representative reach rule on every surface', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-9);
  const TAG = `R305${stamp}`;
  const PLATFORM = { b2b_session: 'stub-admin-session' };
  const REP_SESSION = `stub-305-rep-a-${stamp}`;
  const REP = { b2b_session: REP_SESSION };

  let roleId = '';
  let rolePermissionsBefore: string[] | null = null;
  let repBId = '';
  const org: Record<'O1' | 'U' | 'P' | 'F' | 'Fc', string> = { O1: '', U: '', P: '', F: '', Fc: '' };
  const member: Record<'O1' | 'U' | 'P' | 'F', string> = { O1: '', U: '', P: '', F: '' };
  const rfq: Record<'O1' | 'U' | 'P' | 'F', string> = { O1: '', U: '', P: '', F: '' };

  const get = (url: string, cookies: Record<string, string>) => h.app.inject({ method: 'GET', url, cookies });
  const setRollup = async (on: boolean): Promise<void> => {
    await withSystemScope('#305: toggle the representative roll-up capability', async () => {
      const em = h.orm.em.fork();
      const role = await em.findOneOrFail(AdminRole, { id: roleId });
      const rest = role.permissions.filter((p) => p !== 'organizations:rollup');
      role.permissions = on ? [...rest, 'organizations:rollup'] : rest;
      await em.flush();
    });
  };
  const listedOrganizations = async (cookies: Record<string, string>): Promise<string[]> => {
    const res = await get(`/api/v1/admin/organizations?includePersonal=true&q=${TAG}&limit=100`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Array<{ id: string }> }).data.map((o) => o.id);
  };
  const listedQuoteRequests = async (cookies: Record<string, string>): Promise<string[]> => {
    const res = await get('/api/v1/admin/quote-requests?limit=100&pageSize=100', cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Array<{ id: string }> }).data.map((r) => r.id);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('#305: seed two representatives and five organizations', async () => {
      const em = h.orm.em.fork();
      const grants = ['customers:read', 'customers:manage', 'rfqs:handle', 'orders:read'];
      let role = await em.findOne(AdminRole, { code: 'sales_representative' });
      if (!role) {
        role = em.create(AdminRole, { code: 'sales_representative', name: 'Sales Representative', permissions: grants });
      } else {
        rolePermissionsBefore = [...role.permissions];
        role.permissions = Array.from(new Set([...role.permissions.filter((p) => p !== 'organizations:rollup'), ...grants]));
      }
      await em.persistAndFlush(role);
      roleId = role.id;

      const organization = (label: string, over: Partial<Organization> = {}): Organization =>
        em.create(Organization, {
          name: `${TAG} ${label}`,
          taxId: `PL305${label.toUpperCase()}${stamp}`,
          status: 'active',
          vatStatus: 'vat_payer',
          registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-305', country: 'PL' },
          ...over,
        } as Organization);
      const o1 = organization('o1');
      const u = organization('u');
      const p = organization('p', { isPersonal: true, taxId: null }); // no tax ID (specs/177)
      const f = organization('f');
      await em.persistAndFlush([o1, u, p, f]);
      for (const o of [o1, u, p, f]) o.path = `/${o.id}/`;
      const fc = organization('fc', { parentId: f.id } as Partial<Organization>);
      await em.persistAndFlush(fc);
      fc.path = `${f.path}${fc.id}/`;
      await em.flush();
      Object.assign(org, { O1: o1.id, U: u.id, P: p.id, F: f.id, Fc: fc.id });

      const admin = (label: string): AdminUser =>
        em.create(AdminUser, {
          email: `305-${label}-${stamp}@scope.local`,
          passwordHash: 'x'.repeat(60),
          adminRoleId: role.id,
          firstName: '305',
          lastName: label,
        });
      const repA = admin('rep-a');
      const repB = admin('rep-b');
      await em.persistAndFlush([repA, repB]);
      repBId = repB.id;
      await em.persistAndFlush([
        em.create(OrganizationSalesRepAssignment, { organizationId: o1.id, adminUserId: repA.id }),
        em.create(OrganizationSalesRepAssignment, { organizationId: f.id, adminUserId: repB.id }),
      ]);

      const account = (organizationId: string, label: string): CustomerAccount =>
        em.create(CustomerAccount, {
          organizationId,
          email: `305-${label}-${stamp}@scope.local`,
          passwordHash: 'x'.repeat(60),
          firstName: '305',
          lastName: label,
        });
      const accounts = { O1: account(o1.id, 'o1'), U: account(u.id, 'u'), P: account(p.id, 'p'), F: account(f.id, 'f') };
      await em.persistAndFlush(Object.values(accounts));
      for (const key of Object.keys(accounts) as Array<keyof typeof accounts>) member[key] = accounts[key].id;
      ADMIN_COOKIES[REP_SESSION] = { adminUserId: repA.id };
    });

    for (const key of ['O1', 'U', 'P', 'F'] as const) {
      await bindOrganizationToDefaultChannel(h, org[key]);
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quote-requests',
        cookies: PLATFORM,
        payload: {
          organizationId: org[key],
          customerAccountId: member[key],
          items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, agreedUnitPrice: 10 }],
        },
      });
      expect(res.statusCode, `${key}: ${res.body}`).toBe(201);
      rfq[key] = (res.json() as { data: { id: string } }).data.id;
    }
  }, 120_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[REP_SESSION];
    await h
      .em()
      .getConnection()
      .execute('delete from organization_sales_rep_assignments where admin_user_id = ?', [repBId]);
    if (rolePermissionsBefore !== null) {
      const before = rolePermissionsBefore;
      await withSystemScope('#305: restore the sales representative role', async () => {
        const em = h.orm.em.fork();
        const role = await em.findOneOrFail(AdminRole, { id: roleId });
        role.permissions = before;
        await em.flush();
      });
    }
    await teardownBackendServer(h);
  });

  describe('a flat representative (no roll-up)', () => {
    beforeAll(async () => setRollup(false));

    it.each([
      ['O1', 200],
      ['U', 200],
      ['P', 200],
      ['F', 404],
    ] as const)('GET /admin/organizations/:id for %s answers %i', async (key, status) => {
      expect((await get(`/api/v1/admin/organizations/${org[key]}`, REP)).statusCode).toBe(status);
    });

    it.each([
      ['O1', 200],
      ['U', 200],
      ['P', 200],
      ['F', 404],
    ] as const)('GET /admin/customers/:id for the member of %s answers %i', async (key, status) => {
      const res = await get(`/api/v1/admin/customers/${member[key]}`, REP);
      expect(res.statusCode, res.body).toBe(status);
    });

    it('lists the quote requests of every organization in reach and no other', async () => {
      const listed = await listedQuoteRequests(REP);
      expect(listed).toEqual(expect.arrayContaining([rfq.O1, rfq.U, rfq.P]));
      expect(listed).not.toContain(rfq.F);
    });

    it.each([
      ['O1', 200],
      ['U', 200],
      ['P', 200],
      ['F', 404],
    ] as const)('GET /admin/quote-requests/:id of %s answers %i', async (key, status) => {
      expect((await get(`/api/v1/admin/quote-requests/${rfq[key]}`, REP)).statusCode).toBe(status);
    });

    it.each([
      ['O1', 200],
      ['U', 200],
      ['P', 200],
      ['F', 404],
    ] as const)('the customer-level negotiation setting of the member of %s reads and writes %i', async (key, status) => {
      const url = `/api/v1/admin/customers/${member[key]}/quote-price-negotiation`;
      expect((await get(url, REP)).statusCode).toBe(status);
      const put = await h.app.inject({ method: 'PUT', url, cookies: REP, payload: { override: 'inherit' } });
      expect(put.statusCode, put.body).toBe(status);
    });

    it('the organization list narrows to the same rule', async () => {
      const listed = await listedOrganizations(REP);
      expect([...listed].sort()).toEqual([org.O1, org.U, org.P, org.Fc].sort());
    });

    it('admin search narrows to the same rule, the assigned organization first', async () => {
      const found = await searchIds(h, REP, TAG, 'organizations.organization');
      expect(found[0]).toBe(org.O1);
      expect([...found].sort()).toEqual([org.O1, org.U, org.Fc].sort());
      expect(found).not.toContain(org.F);
    });

    it('under the flat rule, an unassigned child of another representative’s organization is in reach', async () => {
      expect((await get(`/api/v1/admin/organizations/${org.Fc}`, REP)).statusCode).toBe(200);
    });
  });

  describe('a roll-up representative', () => {
    beforeAll(async () => setRollup(true));
    afterAll(async () => setRollup(false));

    it('the unassigned child of another representative’s organization is governed by it, and hidden everywhere', async () => {
      expect((await get(`/api/v1/admin/organizations/${org.Fc}`, REP)).statusCode).toBe(404);
      expect(await listedOrganizations(REP)).not.toContain(org.Fc);
      expect(await searchIds(h, REP, TAG, 'organizations.organization')).not.toContain(org.Fc);
    });

    it('still reaches its own, the unassigned and the personal organization', async () => {
      const listed = await listedOrganizations(REP);
      expect([...listed].sort()).toEqual([org.O1, org.U, org.P].sort());
      for (const key of ['O1', 'U', 'P'] as const) {
        expect((await get(`/api/v1/admin/customers/${member[key]}`, REP)).statusCode).toBe(200);
      }
    });
  });

  describe('a platform administrator', () => {
    it('sees all four columns', async () => {
      for (const key of ['O1', 'U', 'P', 'F'] as const) {
        expect((await get(`/api/v1/admin/organizations/${org[key]}`, PLATFORM)).statusCode).toBe(200);
        expect((await get(`/api/v1/admin/customers/${member[key]}`, PLATFORM)).statusCode).toBe(200);
        expect((await get(`/api/v1/admin/quote-requests/${rfq[key]}`, PLATFORM)).statusCode).toBe(200);
      }
      const listed = await listedOrganizations(PLATFORM);
      expect([...listed].sort()).toEqual([org.O1, org.U, org.P, org.F, org.Fc].sort());
    });
  });
});
