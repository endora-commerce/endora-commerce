import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160 (FR-032) — an organization's effective price books: those whose
 * audience set holds the organization (direct) or an ancestor of it
 * (inherited), and those whose audience set holds its customer group. Read
 * through `PriceListReadPort.listForOrganization`; the organizations module no
 * longer evaluates an application rule of its own.
 */
describe('organizations — effective price books', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterEach(async () => {
    await f.clearBooks();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function applicable(orgId: string) {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${orgId}/applicable-price-lists`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { items: Array<{ priceListId: string; reasons: string[] }> }).items;
  }

  it('lists own, ancestor and customer-group books with their reasons, and nothing else', async () => {
    const own = await f.book({ name: 'AcmeW own', audience: { organizations: [f.orgs.AcmeW] }, rows: [{ percent: '-1' }] });
    const parent = await f.book({ name: 'Acme', audience: { organizations: [f.orgs.Acme] }, rows: [{ percent: '-2' }] });
    const group = await f.book({ name: 'VIP', audience: { groups: [f.groups.VIP] }, rows: [{ percent: '-3' }] });
    const stranger = await f.book({ name: 'Gamma', audience: { organizations: [f.orgs.Gamma] }, rows: [{ percent: '-4' }] });
    const everyone = await f.book({ name: 'Everyone', audience: 'everyone', rows: [{ product: f.products.P1, fixed: '1' }] });
    const draft = await f.book({ name: 'Draft', activate: false, audience: { organizations: [f.orgs.AcmeW] }, rows: [{ percent: '-5' }] });

    const items = await applicable(f.orgs.AcmeW.id);
    const byId = new Map(items.map((it) => [it.priceListId, it.reasons]));
    expect(byId.get(own.id)).toEqual(['direct_organization_match']);
    expect(byId.get(parent.id)).toEqual(['ancestor_organization_match']);
    expect(byId.get(group.id)).toEqual(['customer_group_match']);
    for (const absent of [stranger.id, everyone.id, draft.id]) expect(byId.has(absent)).toBe(false);
  });

  it('answers through the published read port', async () => {
    const own = await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ percent: '-1' }] });
    const port = (h.container as unknown as { resolve<T>(n: string): T }).resolve<{
      listForOrganization(input: {
        organizationChain: readonly string[];
        customerGroupId: string | null;
      }): Promise<Array<{ id: string; reason: string; depth: number | null }>>;
    }>('priceListReadPort');
    expect(await port.listForOrganization({ organizationChain: [f.orgs.AcmeW.id, f.orgs.Acme.id], customerGroupId: null })).toEqual([
      expect.objectContaining({ id: own.id, reason: 'ancestor', depth: 1 }),
    ]);
  });
});
