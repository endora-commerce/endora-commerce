import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Organization } from '../../helpers/package-entities.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  GS_COOKIES,
  ensureSalesRep,
  providerFor,
  providerQuery,
  runToken,
  searchAsPlatform,
  searchIds,
  seedOrganization,
} from '../../helpers/admin-search-fixtures.js';

/**
 * `specs/150-admin-global-search/` T039 — the Organization provider.
 *
 * Diacritic folding on the name (FR-011), the list's exclusions (personal and
 * deleted organizations), and the **owner's answer to spec Q2** (FR-015a): a
 * sales representative sees exactly the organizations the Organizations list
 * shows them — not only their scope — with the ones assigned to them first,
 * then the rest, each group in the usual ranking and in a stable order.
 */
describe('admin global search — Organization provider (spec 150, owner Q2)', () => {
  let h: BackendServerHandle;
  let cleanupSalesRep: () => Promise<void>;
  const T = runToken();
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('test seed: global search organizations', async () => {
      const em = h.em();
      const seed = async (key: string, over: Parameters<typeof seedOrganization>[1]) => {
        ids[key] = (await seedOrganization(em, over)).id;
      };
      await seed('lodz', { name: `Łódź Meble ${T}` });
      await seed('legal', { name: `Plain ${T}`, legalName: `LEGAL${T} Spółka z o.o.` });
      await seed('personal', { name: `PERS${T}`, isPersonal: true });
      await seed('deleted', { name: `DEL${T}` });
      await em.nativeUpdate(Organization, { id: ids['deleted']! }, { deletedAt: new Date() });
      // Owner Q2 — created oldest first: `assigned`, then `other1` and
      // `other2`, which are then given the same change time so only the id
      // can order them.
      await seed('assigned', { name: `Q2${T} Zeta`, taxId: `TX${T}9` });
      await seed('other1', { name: `Q2${T} Alpha`, taxId: `TX${T}` });
      await seed('other2', { name: `Q2${T} Beta` });
      const later = new Date(Date.now() + 60_000);
      await em.nativeUpdate(Organization, { id: { $in: [ids['other1']!, ids['other2']!] } }, { updatedAt: later });
    });
    cleanupSalesRep = await ensureSalesRep(h, [ids['assigned']!], ['customers:read']);
  });

  afterAll(async () => {
    await cleanupSalesRep?.();
    await teardownBackendServer(h);
  });

  const provider = () => providerFor(h, 'organizations.organization');
  const hitIds = async (text: string, fields: string[]) =>
    (await searchAsPlatform(provider(), providerQuery(text, fields))).hits.map((hit) => hit.id);
  const byId = (a?: string, b?: string) => [a!, b!].sort();

  it('finds Łódź when typed without diacritics (FR-011, US1-11)', async () => {
    expect(await hitIds(`lodz meble ${T}`, ['name'])).toEqual([ids['lodz']]);
    expect(await hitIds(`ŁÓDŹ MEBLE ${T}`, ['name'])).toEqual([ids['lodz']]);
  });

  it('matches the legal name only when it is selected', async () => {
    expect(await hitIds(`LEGAL${T}`, ['legalName'])).toEqual([ids['legal']]);
    expect(await hitIds(`LEGAL${T}`, ['name', 'taxId'])).toEqual([]);
  });

  it('never returns a personal or a deleted organization (FR-016)', async () => {
    expect(await hitIds(`PERS${T}`, ['name', 'taxId', 'legalName'])).toEqual([]);
    expect(await hitIds(`DEL${T}`, ['name', 'taxId', 'legalName'])).toEqual([]);
    expect(await hitIds(ids['personal']!, ['name'])).toEqual([]);
  });

  it('maps to the organization screen with tax ID, city and status', async () => {
    const [hit] = (await searchAsPlatform(provider(), providerQuery(`TX${T}9`, ['taxId'], { language: 'pl' }))).hits;
    expect(hit).toMatchObject({
      title: `Q2${T} Zeta`,
      subtitle: `TX${T}9 · Kraków`,
      targetRoute: `/organizations/${ids['assigned']}`,
      status: { code: 'active', label: 'Aktywna' },
    });
  });

  it('gives a platform admin one group: recency, then id', async () => {
    const found = await searchIds(h, GS_COOKIES.admin, `Q2${T}`, 'organizations.organization');
    expect(found).toEqual([...byId(ids['other1'], ids['other2']), ids['assigned']]);
  });

  it("shows a sales representative exactly the Organizations list's rows — not only their scope (owner Q2)", async () => {
    const found = await searchIds(h, GS_COOKIES.salesRep, `Q2${T}`, 'organizations.organization');
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations?q=Q2${T}`,
      cookies: GS_COOKIES.salesRep,
    });
    expect(list.statusCode).toBe(200);
    const listed = (list.json() as { data: Array<{ id: string }> }).data.map((r) => r.id);
    expect([...found].sort()).toEqual([...listed].sort());
    expect(found).toHaveLength(3);
  });

  it('ranks the assigned organization first, then the rest in a stable order (FR-015a)', async () => {
    const expected = [ids['assigned'], ...byId(ids['other1'], ids['other2'])];
    for (let i = 0; i < 3; i += 1) {
      expect(await searchIds(h, GS_COOKIES.salesRep, `Q2${T}`, 'organizations.organization')).toEqual(expected);
    }
  });

  it('keeps assigned-first above an exact tax ID match in the other group', async () => {
    // Platform admin: the exact tax ID first, then the prefix.
    expect(await searchIds(h, GS_COOKIES.admin, `TX${T}`, 'organizations.organization')).toEqual([
      ids['other1'],
      ids['assigned'],
    ]);
    // Sales representative: their assigned organization leads its group.
    expect(await searchIds(h, GS_COOKIES.salesRep, `TX${T}`, 'organizations.organization')).toEqual([
      ids['assigned'],
      ids['other1'],
    ]);
  });
});
