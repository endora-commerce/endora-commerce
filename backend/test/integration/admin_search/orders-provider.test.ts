import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Order } from '../../helpers/package-entities.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  GS_COOKIES,
  assignToAnotherRepresentative,
  ensureSalesRep,
  providerFor,
  providerQuery,
  runToken,
  searchAsPlatform,
  searchIds,
  seedCustomer,
  seedOrder,
  seedOrganization,
} from '../../helpers/admin-search-fixtures.js';

/**
 * `specs/150-admin-global-search/` T027 — the Order provider against a real
 * database: each offered field alone, ranking, the identifier match, literal
 * wildcards, `hasMore`, and the order list's sales-representative scope.
 */
describe('admin global search — Order provider (spec 150)', () => {
  let h: BackendServerHandle;
  let cleanupSalesRep: () => Promise<void>;
  let cleanupOtherRep: (() => Promise<void>) | undefined;
  const T = runToken();
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('test seed: global search orders', async () => {
      const em = h.em();
      const orgA = await seedOrganization(em, { name: `Alpha ${T}` });
      const orgB = await seedOrganization(em, { name: `ORGN${T} Ltd` });
      const orgC = await seedOrganization(em, { name: `Gamma ${T}` });
      const custA = await seedCustomer(em, orgA.id, { email: `a-${T}@example.com`, lastName: 'Plain' });
      const custB = await seedCustomer(em, orgB.id, { email: `b-${T}@example.com`, lastName: `CUST${T}` });
      ids['orgA'] = orgA.id;
      ids['orgC'] = orgC.id;
      ids['orgB'] = orgB.id;
      const order = async (key: string, over: Parameters<typeof seedOrder>[1]) => {
        ids[key] = (await seedOrder(em, over)).id;
      };
      await order('number', { organizationId: orgA.id, customerId: custA.id, businessId: `NUM${T}-1` });
      await order('organizationName', { organizationId: orgB.id, customerId: custA.id, businessId: `ZZ-${T}-a` });
      await order('customer', { organizationId: orgA.id, customerId: custB.id, businessId: `ZZ-${T}-b` });
      await order('billingCompanyName', {
        organizationId: orgA.id,
        customerId: custA.id,
        businessId: `ZZ-${T}-c`,
        billingCompanyName: `BILLCO${T} SA`,
      });
      await order('billingTaxId', {
        organizationId: orgA.id,
        customerId: custA.id,
        businessId: `ZZ-${T}-d`,
        billingTaxId: `TAX${T}99`,
      });
      // Ranking: created exact → prefix → contains, so the contains row is the
      // most recently changed and recency alone would put it first.
      await order('exact', { organizationId: orgA.id, customerId: custA.id, businessId: `RK${T}` });
      await order('prefix', { organizationId: orgA.id, customerId: custA.id, businessId: `RK${T}-2` });
      await order('contains', { organizationId: orgA.id, customerId: custA.id, businessId: `X-RK${T}` });
      await order('wild', { organizationId: orgA.id, customerId: custA.id, businessId: `WC${T}%_x` });
      await order('tame', { organizationId: orgA.id, customerId: custA.id, businessId: `WC${T}ab` });
      await order('scopeA', { organizationId: orgA.id, customerId: custA.id, businessId: `SR${T}-a` });
      await order('scopeB', { organizationId: orgC.id, customerId: custA.id, businessId: `SR${T}-b` });
    });
    cleanupSalesRep = await ensureSalesRep(h, [ids['orgA']!], ['orders:read']);
    // #305 — the other organizations are another representative's: one nobody
    // is assigned to is in every representative's reach.
    cleanupOtherRep = await assignToAnotherRepresentative(h, [ids['orgB']!, ids['orgC']!]);
  });

  afterAll(async () => {
    await cleanupOtherRep?.();
    await cleanupSalesRep?.();
    await teardownBackendServer(h);
  });

  const provider = () => providerFor(h, 'orders.order');
  const hitIds = async (text: string, fields: string[], over = {}) =>
    (await searchAsPlatform(provider(), providerQuery(text, fields, over))).hits.map((hit) => hit.id);

  it.each([
    ['number', `NUM${T}`],
    ['organizationName', `ORGN${T}`],
    ['customer', `CUST${T}`],
    ['billingCompanyName', `BILLCO${T}`],
    ['billingTaxId', `TAX${T}`],
  ])('matches %s alone, and only that order', async (field, text) => {
    expect(await hitIds(text, [field])).toEqual([ids[field]]);
    // Every other field selected instead: nothing.
    const others = ['number', 'organizationName', 'customer', 'billingCompanyName', 'billingTaxId'].filter(
      (f) => f !== field,
    );
    expect(await hitIds(text, others)).toEqual([]);
  });

  it('ranks the exact number first, then the prefix, then the rest (US1-6)', async () => {
    expect(await hitIds(`RK${T}`, ['number'])).toEqual([ids['exact'], ids['prefix'], ids['contains']]);
    expect(await hitIds(`rk${T}`, ['number'])).toEqual([ids['exact'], ids['prefix'], ids['contains']]);
  });

  it('finds an order by its id whatever fields are selected (FR-010)', async () => {
    expect(await hitIds(ids['number']!, ['organizationName'])).toEqual([ids['number']]);
  });

  it('matches wildcard characters literally (FR-012)', async () => {
    expect(await hitIds(`WC${T}%_`, ['number'])).toEqual([ids['wild']]);
    expect(await hitIds(`WC${T}_b`, ['number'])).toEqual([]);
  });

  it('answers hasMore from limit + 1', async () => {
    const result = await searchAsPlatform(provider(), providerQuery(`RK${T}`, ['number'], { limit: 2 }));
    expect(result.hits.map((hit) => hit.id)).toEqual([ids['exact'], ids['prefix']]);
    expect(result.hasMore).toBe(true);
    const all = await searchAsPlatform(provider(), providerQuery(`RK${T}`, ['number'], { limit: 3 }));
    expect(all.hasMore).toBe(false);
  });

  it('maps a hit to its admin screen, organization and status', async () => {
    const [hit] = (await searchAsPlatform(provider(), providerQuery(`NUM${T}`, ['number']))).hits;
    expect(hit).toMatchObject({ title: `NUM${T}-1`, targetRoute: `/orders/${ids['number']}` });
    expect(hit?.subtitle).toContain(`Alpha ${T}`);
    expect(hit?.status?.code).toBe('new');
  });

  it("gives a sales representative only their organizations' orders (FR-015, US1-7)", async () => {
    expect(await searchIds(h, GS_COOKIES.admin, `SR${T}`, 'orders.order')).toEqual(
      expect.arrayContaining([ids['scopeA'], ids['scopeB']]),
    );
    expect(await searchIds(h, GS_COOKIES.salesRep, `SR${T}`, 'orders.order')).toEqual([ids['scopeA']]);
    // The same set the order list shows them.
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders?q=SR${T}&page=1&pageSize=50`,
      cookies: GS_COOKIES.salesRep,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: Array<{ id: string }> }).data.map((r) => r.id)).toEqual([ids['scopeA']]);
    void Order;
  });
});
