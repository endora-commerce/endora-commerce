import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { createSalesRep, priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 161, G12 (`contracts/backend-gaps.md`) — a book's organization
 * members are stored as ids, so the header editor and the list's member chip
 * label them through `GET …/targets/organizations?ids=`. Scope-filtered
 * exactly as the search: an organization outside the caller's scope is absent,
 * as an unknown id is, and neither is an error that would reveal existence.
 */
describe('price-book targets — organizations by id (161 G12)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let rep: Awaited<ReturnType<typeof createSalesRep>>;
  const UNKNOWN = '00000000-0000-4000-8000-0000001612dd';

  type Items = { data: { items: Array<{ id: string; name: string; taxId: string | null }> } };
  const byIds = (ids: readonly string[], cookies?: Record<string, string>, extra = '') =>
    api.get<Items>(`/api/v1/admin/price-books/targets/organizations?ids=${ids.join(',')}${extra}`, cookies);

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    rep = await createSalesRep(h, { assignedOrganizationIds: [f.orgs.Acme.id], otherOrganizationIds: [f.orgs.Beta.id] });
  }, 5 * 60_000);

  afterAll(async () => {
    rep.release();
    await teardownBackendServer(h);
  });

  it('labels every named organization for a platform administrator, unknown ids absent', async () => {
    const res = await byIds([f.orgs.Acme.id, f.orgs.Beta.id, UNKNOWN]);
    expect(res.status, res.raw).toBe(200);
    const items = res.body.data.items;
    expect(items.map((i) => i.id).sort()).toEqual([f.orgs.Acme.id, f.orgs.Beta.id].sort());
    const acme = items.find((i) => i.id === f.orgs.Acme.id)!;
    expect(acme.name).toMatch(/^Acme B2B \(demo\)/);
    expect(acme.taxId).toEqual(expect.any(String));
  });

  it('omits an out-of-scope organization for a representative exactly as an unknown one', async () => {
    const res = await byIds([f.orgs.Acme.id, f.orgs.Beta.id, UNKNOWN], rep.cookies);
    expect(res.status, res.raw).toBe(200);
    expect(res.body.data.items.map((i) => i.id)).toEqual([f.orgs.Acme.id]);
    const hidden = await byIds([f.orgs.Beta.id], rep.cookies);
    const unknown = await byIds([UNKNOWN], rep.cookies);
    expect(hidden.status).toBe(200);
    expect(hidden.body).toEqual(unknown.body);
    expect(hidden.body.data.items).toEqual([]);
  });

  it('refuses ids together with search, a malformed id, and more ids than an audience may name', async () => {
    expect((await byIds([f.orgs.Acme.id], undefined, '&search=Acme')).status).toBe(400);
    expect((await byIds(['not-a-uuid'])).status).toBe(400);
    const tooMany = Array.from({ length: 1001 }, (_, i) => `00000000-0000-4000-8000-${(0x1612000 + i).toString(16).padStart(12, '0')}`);
    expect((await byIds(tooMany)).status).toBe(400);
  });

  it('keeps the search answering as before', async () => {
    const res = await api.get<Items>(`/api/v1/admin/price-books/targets/organizations?search=${encodeURIComponent('Acme B2B')}`);
    expect(res.status, res.raw).toBe(200);
    expect(res.body.data.items.some((i) => i.id === f.orgs.Acme.id)).toBe(true);
  });
});
