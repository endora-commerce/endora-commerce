import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CustomerAccountAdminSearchPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  GS_COOKIES,
  assignToAnotherRepresentative,
  ensureSalesRep,
  runToken,
  searchIds,
  seedCustomer,
  seedOrganization,
} from '../../helpers/admin-search-fixtures.js';

/**
 * `specs/150-admin-global-search/` T042 — the two additive criteria on
 * `customer_accounts`' admin search port (`qFields`, `excludeDeleted`), the
 * unchanged behaviour without them, and the Customer provider's scope: a sales
 * representative receives exactly what their customer list shows.
 */
describe('admin global search — Customer provider and search criteria (spec 150)', () => {
  let h: BackendServerHandle;
  let cleanupSalesRep: () => Promise<void>;
  let cleanupOtherRep: (() => Promise<void>) | undefined;
  const T = runToken();
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('test seed: global search customers', async () => {
      const em = h.em();
      const orgA = await seedOrganization(em, { name: `Alpha ${T}` });
      const orgB = await seedOrganization(em, { name: `Beta ${T}` });
      ids['orgA'] = orgA.id;
      ids['orgB'] = orgB.id;
      ids['byEmail'] = (await seedCustomer(em, orgA.id, { email: `mail${T}@example.com`, lastName: 'Plain' })).id;
      ids['byName'] = (await seedCustomer(em, orgA.id, { email: `x-${T}@example.com`, lastName: `NAME${T}` })).id;
      ids['deleted'] = (await seedCustomer(em, orgA.id, { email: `gone${T}@example.com` })).id;
      ids['anonymized'] = (await seedCustomer(em, orgA.id, { email: `anon${T}@example.com` })).id;
      ids['scopeA'] = (await seedCustomer(em, orgA.id, { email: `sr${T}-a@example.com` })).id;
      ids['scopeB'] = (await seedCustomer(em, orgB.id, { email: `sr${T}-b@example.com` })).id;
      await em.nativeUpdate(CustomerAccount, { id: ids['deleted'] }, { deletedAt: new Date() });
      await em.nativeUpdate(CustomerAccount, { id: ids['anonymized'] }, { anonymizedAt: new Date() });
    });
    cleanupSalesRep = await ensureSalesRep(h, [ids['orgA']!], ['customers:read']);
    // #305 — the other organizations are another representative's: one nobody
    // is assigned to is in every representative's reach.
    cleanupOtherRep = await assignToAnotherRepresentative(h, [ids['orgB']!]);
  });

  afterAll(async () => {
    await cleanupOtherRep?.();
    await cleanupSalesRep?.();
    await teardownBackendServer(h);
  });

  async function portIds(criteria: Partial<Parameters<CustomerAccountAdminSearchPort['search']>[0]>): Promise<string[]> {
    const port = h.container.resolve('customerAccountAdminSearchPort') as CustomerAccountAdminSearchPort;
    const result = await withSystemScope('test: customer admin search port', () =>
      port.search({ allowedOrganizationIds: null, page: 1, pageSize: 50, ...criteria }),
    );
    return result.rows.map((r) => r.id);
  }

  it('matches only the selected fields when qFields is given', async () => {
    expect(await portIds({ q: `mail${T}`, qFields: ['email'] })).toEqual([ids['byEmail']]);
    expect(await portIds({ q: `mail${T}`, qFields: ['name'] })).toEqual([]);
    expect(await portIds({ q: `NAME${T}`, qFields: ['name'] })).toEqual([ids['byName']]);
    expect(await portIds({ q: `NAME${T}`, qFields: ['email'] })).toEqual([]);
    expect(await portIds({ q: `NAME${T}`, qFields: [] })).toEqual([]);
  });

  it('matches literally under qFields', async () => {
    expect(await portIds({ q: `mail${T}%`, qFields: ['email'] })).toEqual([]);
  });

  it('leaves out deleted and anonymized accounts with excludeDeleted', async () => {
    const all = await portIds({ q: T, qFields: ['email'], excludeDeleted: true });
    expect(all).not.toContain(ids['deleted']);
    expect(all).not.toContain(ids['anonymized']);
    expect(all).toContain(ids['byEmail']);
  });

  it('keeps today’s behaviour when both criteria are absent (regression guard for the list)', async () => {
    // Name and e-mail both matched; the anonymized account is still listed and
    // the deleted one is not — exactly what `GET /api/v1/admin/customers` did.
    const found = await portIds({ q: T });
    expect(found).toEqual(expect.arrayContaining([ids['byEmail'], ids['byName'], ids['anonymized']]));
    expect(found).not.toContain(ids['deleted']);
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/customers?q=${T}&pageSize=100`,
      cookies: GS_COOKIES.admin,
    });
    expect(list.statusCode).toBe(200);
    const listed = (list.json() as { data: Array<{ id: string }> }).data.map((r) => r.id);
    expect([...listed].sort()).toEqual([...found].sort());
  });

  it('finds the e-mail and the name through the search API, never a deleted or anonymized account', async () => {
    expect(await searchIds(h, GS_COOKIES.admin, `mail${T}`, 'customers.customer')).toEqual([ids['byEmail']]);
    expect(await searchIds(h, GS_COOKIES.admin, `NAME${T}`, 'customers.customer')).toEqual([ids['byName']]);
    expect(await searchIds(h, GS_COOKIES.admin, `anon${T}`, 'customers.customer')).toEqual([]);
    expect(await searchIds(h, GS_COOKIES.admin, ids['anonymized']!, 'customers.customer')).toEqual([]);
    expect(await searchIds(h, GS_COOKIES.admin, ids['byName']!, 'customers.customer')).toEqual([ids['byName']]);
  });

  it("gives a sales representative exactly their customer list's rows", async () => {
    expect((await searchIds(h, GS_COOKIES.admin, `sr${T}`, 'customers.customer')).sort()).toEqual(
      [ids['scopeA'], ids['scopeB']].sort(),
    );
    const found = await searchIds(h, GS_COOKIES.salesRep, `sr${T}`, 'customers.customer');
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/customers?q=sr${T}`,
      cookies: GS_COOKIES.salesRep,
    });
    expect(list.statusCode).toBe(200);
    expect(found).toEqual([ids['scopeA']]);
    expect((list.json() as { data: Array<{ id: string }> }).data.map((r) => r.id)).toEqual(found);
    expect(await searchIds(h, GS_COOKIES.salesRep, ids['scopeB']!, 'customers.customer')).toEqual([]);
  });
});
