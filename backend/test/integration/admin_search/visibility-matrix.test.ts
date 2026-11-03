import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Category, Product, QuoteRequest } from '../../helpers/package-entities.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { createCrmOpportunity } from '../../helpers/seed-crm.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  GS_COOKIES,
  ensureAdminWithRole,
  ensureSalesRep,
  runToken,
  seedCustomer,
  seedOrder,
  seedOrganization,
} from '../../helpers/admin-search-fixtures.js';

/**
 * `specs/150-admin-global-search/` SC-003 (T051) — the permission and scope
 * matrix over one seed that matches all seven record types.
 *
 *  - a platform administrator sees seven groups;
 *  - a sales representative assigned to one organization sees only that
 *    organization's orders, quote requests, opportunities and customers — and,
 *    by the owner's answer to spec Q2, every organization the Organizations
 *    list shows, the assigned one first;
 *  - a role lacking each read code in turn loses exactly the groups that code
 *    reads, from both the results and the capability.
 */
describe('admin global search — visibility matrix (spec 150, SC-003)', () => {
  let h: BackendServerHandle;
  let cleanupSalesRep: () => Promise<void>;
  const T = runToken();
  const q = `acme${T}`;
  const ids: Record<string, string> = {};
  const cookiesAdded: string[] = [];
  const READ_CODES = ['orders:read', 'rfqs:handle', 'crm:read', 'customers:read', 'catalog:read'] as const;
  const SEVEN = [
    'orders.order',
    'quote_requests.quote_request',
    'crm.opportunity',
    'organizations.organization',
    'customers.customer',
    'catalog.product',
    'catalog.category',
  ];

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('test seed: global search visibility matrix', async () => {
      const em = h.em();
      const orgA = await seedOrganization(em, { name: `ACME${T} Assigned` });
      const orgB = await seedOrganization(em, { name: `ACME${T} Other` });
      ids['orgA'] = orgA.id;
      ids['orgB'] = orgB.id;
      const custA = await seedCustomer(em, orgA.id, { email: `acme${T}-a@example.com` });
      const custB = await seedCustomer(em, orgB.id, { email: `acme${T}-b@example.com` });
      ids['custA'] = custA.id;
      ids['custB'] = custB.id;
      ids['orderA'] = (await seedOrder(em, { organizationId: orgA.id, customerId: custA.id, businessId: `ACME${T}-A` })).id;
      ids['orderB'] = (await seedOrder(em, { organizationId: orgB.id, customerId: custB.id, businessId: `ACME${T}-B` })).id;
      for (const [key, organizationId, customerAccountId] of [
        ['rfqA', orgA.id, custA.id],
        ['rfqB', orgB.id, custB.id],
      ] as const) {
        const rfq = em.create(QuoteRequest, { organizationId, customerAccountId, businessId: `ACME${T}-${key}` } as never);
        await em.persistAndFlush(rfq);
        ids[key] = (rfq as { id: string }).id;
      }
      const product = em.create(Product, {
        sku: `ACME${T}`,
        slug: `acme-${T}`,
        type: 'simple',
        status: 'active',
        name: 'Anvil',
        description: '',
        visibility: 'public',
        attributeValues: {},
      } as never);
      const category = em.create(Category, { name: { 'en-US': `ACME${T} tools` }, slug: `tools-${T}` } as never);
      await em.persistAndFlush([product, category]);
      ids['product'] = (product as { id: string }).id;
      ids['category'] = (category as { id: string }).id;
    });
    ids['oppA'] = (await createCrmOpportunity(h, { organizationId: ids['orgA'], title: `ACME${T} deal a` })).id;
    ids['oppB'] = (await createCrmOpportunity(h, { organizationId: ids['orgB'], title: `ACME${T} deal b` })).id;
    cleanupSalesRep = await ensureSalesRep(h, [ids['orgA']!], [...READ_CODES]);
  });

  afterAll(async () => {
    for (const cookie of cookiesAdded) delete ADMIN_COOKIES[cookie];
    await cleanupSalesRep?.();
    await teardownBackendServer(h);
  });

  async function sessionWith(permissions: readonly string[]): Promise<Record<string, string>> {
    const adminUserId = randomUUID();
    await ensureAdminWithRole(h, adminUserId, `gs_matrix_${randomUUID().slice(0, 8)}`, permissions);
    const cookie = `stub-gs-matrix-${adminUserId}`;
    ADMIN_COOKIES[cookie] = { adminUserId };
    cookiesAdded.push(cookie);
    return { b2b_session: cookie };
  }

  /** Every group's hit ids for `q`, keyed by entity type — what the caller is shown. */
  async function groups(cookies: Record<string, string>): Promise<Record<string, string[]>> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/global-search?q=${q}&language=en&limit=25`,
      cookies,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { groups: Array<{ entityType: string; status: string; hits: Array<{ id: string }> }> } };
    for (const group of body.data.groups) expect(group.status, group.entityType).toBe('ok');
    return Object.fromEntries(body.data.groups.map((g) => [g.entityType, g.hits.map((hit) => hit.id)]));
  }

  async function capability(cookies: Record<string, string>): Promise<string[]> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/global-search/capability?language=en', cookies });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { entityTypes: Array<{ entityType: string }> } }).data.entityTypes.map((e) => e.entityType);
  }

  it('shows a platform administrator seven groups, in the fixed order', async () => {
    const found = await groups(GS_COOKIES.admin);
    expect(Object.keys(found)).toEqual(SEVEN);
    expect(found['orders.order']?.sort()).toEqual([ids['orderA'], ids['orderB']].sort());
    expect(found['quote_requests.quote_request']?.sort()).toEqual([ids['rfqA'], ids['rfqB']].sort());
    expect(found['crm.opportunity']?.sort()).toEqual([ids['oppA'], ids['oppB']].sort());
    expect(found['organizations.organization']?.sort()).toEqual([ids['orgA'], ids['orgB']].sort());
    expect(found['customers.customer']?.sort()).toEqual([ids['custA'], ids['custB']].sort());
    expect(found['catalog.product']).toEqual([ids['product']]);
    expect(found['catalog.category']).toEqual([ids['category']]);
    // Offered besides the seven: the record types later features contribute
    // (`specs/163-projects-and-tasks/`), which match nothing of this seed.
    expect(await capability(GS_COOKIES.admin)).toEqual([...SEVEN, 'projects.project', 'tasks.task']);
  });

  it('confines a sales representative to their organization, except Organizations (owner Q2)', async () => {
    const found = await groups(GS_COOKIES.salesRep);
    expect(found['orders.order']).toEqual([ids['orderA']]);
    expect(found['quote_requests.quote_request']).toEqual([ids['rfqA']]);
    expect(found['crm.opportunity']).toEqual([ids['oppA']]);
    expect(found['customers.customer']).toEqual([ids['custA']]);
    // Every organization the Organizations list shows them, the assigned one first.
    expect(found['organizations.organization']).toEqual([ids['orgA'], ids['orgB']]);
    expect(found['catalog.product']).toEqual([ids['product']]);
    expect(found['catalog.category']).toEqual([ids['category']]);
    expect(await capability(GS_COOKIES.salesRep)).toEqual(SEVEN);
  });

  const LOSES: Record<(typeof READ_CODES)[number], string[]> = {
    'orders:read': ['orders.order'],
    'rfqs:handle': ['quote_requests.quote_request'],
    'crm:read': ['crm.opportunity'],
    // The Organizations list's gate is any of customers:read / customers:manage.
    'customers:read': ['organizations.organization', 'customers.customer'],
    'catalog:read': ['catalog.product', 'catalog.category'],
  };

  it.each(READ_CODES)('removes exactly the groups %s reads, from results and capability (FR-014)', async (code) => {
    const session = await sessionWith(READ_CODES.filter((c) => c !== code));
    const expected = SEVEN.filter((type) => !LOSES[code].includes(type));
    expect(Object.keys(await groups(session))).toEqual(expected);
    expect(await capability(session)).toEqual(expected);
  });
});
