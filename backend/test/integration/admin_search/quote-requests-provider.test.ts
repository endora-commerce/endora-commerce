import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OrganizationSalesRepAssignment, QuoteRequest } from '../../helpers/package-entities.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  GS_COOKIES,
  GS_RESTRICTED_ID,
  ensureAdminWithRole,
  ensureSalesRep,
  providerFor,
  providerQuery,
  runToken,
  searchAsPlatform,
  searchIds,
  seedCustomer,
  seedOrganization,
} from '../../helpers/admin-search-fixtures.js';

/**
 * `specs/150-admin-global-search/` T031 — the Quote Request provider: each
 * field, ranking, the identifier match, literal wildcards, `hasMore`, and the
 * quote request list's visibility, which the provider applies in its statement
 * rather than by loading every row (research R-16a).
 */
describe('admin global search — Quote Request provider (spec 150)', () => {
  let h: BackendServerHandle;
  let cleanupSalesRep: () => Promise<void>;
  const T = runToken();
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('test seed: global search quote requests', async () => {
      const em = h.em();
      const orgA = await seedOrganization(em, { name: `Alpha ${T}` });
      const orgB = await seedOrganization(em, { name: `Beta ${T}` });
      const orgD = await seedOrganization(em, { name: `ORGN${T} Ltd` });
      const orgC = await seedOrganization(em, { name: `Gamma ${T}` });
      ids['orgA'] = orgA.id;
      ids['orgB'] = orgB.id;
      ids['orgC'] = orgC.id;
      const custA = await seedCustomer(em, orgA.id, { email: `qa-${T}@example.com`, lastName: 'Plain' });
      const custC = await seedCustomer(em, orgC.id, { email: `qc-${T}@example.com`, lastName: `CUST${T}` });
      const rfq = async (key: string, organizationId: string, customerAccountId: string, businessId: string, headerNote?: string) => {
        const row = em.create(QuoteRequest, {
          organizationId,
          customerAccountId,
          businessId,
          ...(headerNote !== undefined ? { headerNote } : {}),
        } as never);
        await em.persistAndFlush(row);
        ids[key] = (row as { id: string }).id;
      };
      await rfq('number', orgA.id, custA.id, `NUM${T}-1`);
      await rfq('organizationName', orgD.id, custA.id, `ZZ-${T}-a`);
      await rfq('customer', orgA.id, custC.id, `ZZ-${T}-b`);
      await rfq('customerNote', orgA.id, custA.id, `ZZ-${T}-c`, `Please quote NOTE${T} urgently`);
      await rfq('exact', orgA.id, custA.id, `RK${T}`);
      await rfq('prefix', orgA.id, custA.id, `RK${T}-2`);
      await rfq('contains', orgA.id, custA.id, `X-RK${T}`);
      await rfq('wild', orgA.id, custA.id, `WC${T}%_x`);
      await rfq('tame', orgA.id, custA.id, `WC${T}ab`);
      await rfq('scopeA', orgA.id, custA.id, `SR${T}-a`);
      await rfq('scopeB', orgB.id, custA.id, `SR${T}-b`);
      await rfq('scopeC', orgC.id, custA.id, `SR${T}-c`);
    });
    // The representative reaches orgA; the custom-role admin is assigned orgB,
    // so the list shows it orgB (assigned) and orgC (nobody's) but not orgA.
    cleanupSalesRep = await ensureSalesRep(h, [ids['orgA']!], ['rfqs:handle']);
    await ensureAdminWithRole(h, GS_RESTRICTED_ID, 'global_search_rfq_handler', ['rfqs:handle']);
    await withSystemScope('test seed: global search rfq assignment', async () => {
      const em = h.em();
      em.create(OrganizationSalesRepAssignment, { adminUserId: GS_RESTRICTED_ID, organizationId: ids['orgB']! });
      await em.flush();
    });
  });

  afterAll(async () => {
    await withSystemScope('test cleanup: global search rfq assignment', async () => {
      const em = h.em();
      const rows = await em.find(OrganizationSalesRepAssignment, { adminUserId: GS_RESTRICTED_ID });
      if (rows.length > 0) await em.removeAndFlush(rows);
    });
    await cleanupSalesRep?.();
    await teardownBackendServer(h);
  });

  const provider = () => providerFor(h, 'quote_requests.quote_request');
  const hitIds = async (text: string, fields: string[], over = {}) =>
    (await searchAsPlatform(provider(), providerQuery(text, fields, over))).hits.map((hit) => hit.id);

  it.each([
    ['number', `NUM${T}`],
    ['organizationName', `ORGN${T}`],
    ['customer', `CUST${T}`],
    ['customerNote', `NOTE${T}`],
  ])('matches %s alone, and only that quote request', async (field, text) => {
    expect(await hitIds(text, [field])).toEqual([ids[field]]);
    const others = ['number', 'organizationName', 'customer', 'customerNote'].filter((f) => f !== field);
    expect(await hitIds(text, others)).toEqual([]);
  });

  it('ranks the exact number first, then the prefix, then the rest', async () => {
    expect(await hitIds(`rk${T}`, ['number'])).toEqual([ids['exact'], ids['prefix'], ids['contains']]);
  });

  it('finds a quote request by id whatever fields are selected, and wildcards literally', async () => {
    expect(await hitIds(ids['number']!, ['customerNote'])).toEqual([ids['number']]);
    expect(await hitIds(`WC${T}%_`, ['number'])).toEqual([ids['wild']]);
  });

  it('answers hasMore from limit + 1', async () => {
    const result = await searchAsPlatform(provider(), providerQuery(`RK${T}`, ['number'], { limit: 2 }));
    expect(result.hasMore).toBe(true);
    expect(result.hits).toHaveLength(2);
  });

  it('maps to the quote request screen with a localized status', async () => {
    const [hit] = (await searchAsPlatform(provider(), providerQuery(`NUM${T}`, ['number'], { language: 'pl' }))).hits;
    expect(hit).toMatchObject({ title: `NUM${T}-1`, targetRoute: `/quote-requests/${ids['number']}` });
    expect(hit?.status).toEqual({ code: 'Pending', label: 'Oczekujące' });
  });

  /** The seeded `SR…` quote requests the list shows `cookies`, in no particular order. */
  async function listed(cookies: Record<string, string>): Promise<string[]> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/quote-requests', cookies });
    expect(res.statusCode).toBe(200);
    const mine = new Set([ids['scopeA'], ids['scopeB'], ids['scopeC']]);
    return (res.json() as { data: Array<{ id: string }> }).data.map((r) => r.id).filter((id) => mine.has(id)).sort();
  }

  it.each([
    ['the platform administrator', 'admin'],
    ['a sales representative', 'salesRep'],
    ['a custom role holding rfqs:handle', 'restricted'],
  ] as const)('gives %s exactly the rows the quote request list shows them (FR-015)', async (_who, key) => {
    const cookies = GS_COOKIES[key];
    const found = (await searchIds(h, cookies, `SR${T}`, 'quote_requests.quote_request')).sort();
    expect(found).toEqual(await listed(cookies));
  });

  // PR #954, ruling Q3 — the list's own per-organization pass runs only for a
  // role the tenant filter leaves unrestricted. The custom role keeps being
  // narrowed by it (issue #957 holds the question whether it should be); the
  // representative, whom the tenant filter already narrows, gets the same rows.
  it('narrows the quote request list of a custom role holding rfqs:handle by the assignment rule', async () => {
    expect(await listed(GS_COOKIES.restricted)).toEqual([ids['scopeB'], ids['scopeC']].sort());
  });

  it('gives the sales representative the same list rows as before the per-organization pass was skipped for them', async () => {
    expect(await listed(GS_COOKIES.salesRep)).toEqual([ids['scopeA'], ids['scopeC']].sort());
  });

  // Issue #305 — one reach rule: the representative reaches their assigned
  // organization and every organization nobody is assigned to (orgC), never
  // another's (orgB).
  it('confines the sales representative to the organizations they reach', async () => {
    expect((await searchIds(h, GS_COOKIES.salesRep, `SR${T}`, 'quote_requests.quote_request')).sort()).toEqual(
      [ids['scopeA'], ids['scopeC']].sort(),
    );
    expect((await searchIds(h, GS_COOKIES.restricted, `SR${T}`, 'quote_requests.quote_request')).sort()).toEqual(
      [ids['scopeB'], ids['scopeC']].sort(),
    );
  });
});
