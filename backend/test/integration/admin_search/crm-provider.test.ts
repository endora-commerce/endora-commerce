import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { createCrmOpportunity } from '../../helpers/seed-crm.js';
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
  seedOrganization,
} from '../../helpers/admin-search-fixtures.js';

/**
 * `specs/150-admin-global-search/` T035 — the Sales Opportunity provider: each
 * field, the number ranked first, the identifier match, literal wildcards,
 * `hasMore`, and the opportunity list's tenant scope.
 */
describe('admin global search — Sales Opportunity provider (spec 150)', () => {
  let h: BackendServerHandle;
  let cleanupSalesRep: () => Promise<void>;
  let cleanupOtherRep: (() => Promise<void>) | undefined;
  const T = runToken();
  const ids: Record<string, string> = {};
  let numbered = { id: '', number: '' };

  beforeAll(async () => {
    h = await setupBackendServer();
    const orgs: Record<string, string> = {};
    await withSystemScope('test seed: global search opportunities', async () => {
      const em = h.em();
      orgs['a'] = (await seedOrganization(em, { name: `Alpha ${T}` })).id;
      orgs['b'] = (await seedOrganization(em, { name: `Beta ${T}` })).id;
      orgs['named'] = (await seedOrganization(em, { name: `ORGN${T} Ltd` })).id;
    });
    const create = async (key: string, body: Record<string, unknown>) => {
      const created = await createCrmOpportunity(h, { organizationId: orgs['a'], ...body });
      ids[key] = created.id;
      return created;
    };
    numbered = await create('number', { title: `Plain ${T}` });
    await create('title', { title: `TITLE${T} roll-out` });
    await create('organizationName', { title: 'Unrelated', organizationId: orgs['named'] });
    await create('description', { title: 'Unrelated too', description: `Needs DESC${T} before Q4` });
    // Mentions the first one's number in its title and is more recent: the
    // exact number still ranks first.
    await create('mentions', { title: `Follow-up to ${numbered.number}` });
    await create('wild', { title: `WC${T}%_x` });
    await create('tame', { title: `WC${T}ab` });
    await create('scopeA', { title: `SR${T} a` });
    await create('scopeB', { title: `SR${T} b`, organizationId: orgs['b'] });
    ids['orgA'] = orgs['a']!;
    cleanupSalesRep = await ensureSalesRep(h, [orgs['a']!], ['crm:read']);
    // #305 — the other organizations are another representative's: one nobody
    // is assigned to is in every representative's reach.
    cleanupOtherRep = await assignToAnotherRepresentative(h, [orgs['b']!, orgs['named']!]);
  });

  afterAll(async () => {
    await cleanupOtherRep?.();
    await cleanupSalesRep?.();
    await teardownBackendServer(h);
  });

  const provider = () => providerFor(h, 'crm.opportunity');
  const hitIds = async (text: string, fields: string[], over = {}) =>
    (await searchAsPlatform(provider(), providerQuery(text, fields, over))).hits.map((hit) => hit.id);

  it.each([
    ['title', `TITLE${T}`],
    ['organizationName', `ORGN${T}`],
    ['description', `DESC${T}`],
  ])('matches %s alone, and only that opportunity', async (field, text) => {
    expect(await hitIds(text, [field])).toEqual([ids[field]]);
    const others = ['number', 'title', 'organizationName', 'description'].filter((f) => f !== field);
    expect(await hitIds(text, others)).toEqual([]);
  });

  it('matches the number, and ranks the exact number before a more recent title mention', async () => {
    expect(await hitIds(numbered.number, ['number'])).toEqual([ids['number']]);
    expect(await hitIds(numbered.number, ['number', 'title'])).toEqual([ids['number'], ids['mentions']]);
    expect(await hitIds(numbered.number.toLowerCase(), ['number', 'title'])).toEqual([ids['number'], ids['mentions']]);
  });

  it('finds an opportunity by id whatever fields are selected, and wildcards literally', async () => {
    expect(await hitIds(ids['title']!, ['description'])).toEqual([ids['title']]);
    expect(await hitIds(`WC${T}%_`, ['title'])).toEqual([ids['wild']]);
  });

  it('answers hasMore from limit + 1, and maps to the opportunity screen', async () => {
    const result = await searchAsPlatform(provider(), providerQuery(`WC${T}`, ['title'], { limit: 1 }));
    expect(result.hasMore).toBe(true);
    expect(result.hits).toHaveLength(1);
    const [hit] = (await searchAsPlatform(provider(), providerQuery(`TITLE${T}`, ['title']))).hits;
    expect(hit).toMatchObject({
      title: expect.stringContaining(`TITLE${T}`),
      subtitle: `Alpha ${T}`,
      targetRoute: `/crm/opportunities/${ids['title']}`,
    });
    expect(hit?.status?.label).toEqual(expect.any(String));
  });

  it("gives a sales representative exactly the opportunity list's rows (FR-015)", async () => {
    expect((await searchIds(h, GS_COOKIES.admin, `SR${T}`, 'crm.opportunity')).sort()).toEqual(
      [ids['scopeA'], ids['scopeB']].sort(),
    );
    const found = await searchIds(h, GS_COOKIES.salesRep, `SR${T}`, 'crm.opportunity');
    expect(found).toEqual([ids['scopeA']]);
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/crm/opportunities?q=SR${T}`,
      cookies: GS_COOKIES.salesRep,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: Array<{ id: string }> }).data.map((r) => r.id)).toEqual(found);
  });
});
