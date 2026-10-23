import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { createSalesRep, priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import {
  priceBookTargetAttributesResponseSchema,
  priceBookTargetCategoriesResponseSchema,
  priceBookTargetCurrenciesResponseSchema,
  priceBookTargetCustomerGroupsResponseSchema,
  priceBookTargetOrganizationsResponseSchema,
  priceBookTargetSalesChannelsResponseSchema,
} from '@endora-commerce/contracts';

/**
 * Feature 160 (US7, T099, FR-007, FR-003) — the pickers the price-book editor
 * builds a header and rows from, moved under `/api/v1/admin/price-books/targets/`:
 * only eligible *Price list rules* attributes with their option values, only
 * channels offering a currency when one is asked, and a representative's
 * organizations only.
 */
describe('admin price-book targets (feature 160 US7)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let rep: Awaited<ReturnType<typeof createSalesRep>>;

  type Items<T> = { data: { items: T[] } };

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

  it('lists only eligible price-rule attributes, with their option values', async () => {
    const res = await api.get<Items<{ key: string; options: Array<{ value: string; label: string }> }>>(
      '/api/v1/admin/price-books/targets/attributes',
    );
    expect(res.status, res.raw).toBe(200);
    const color = res.body.data.items.find((a) => a.key === 'color');
    expect(color).toBeDefined();
    expect(color!.options.map((o) => o.value)).toEqual(expect.arrayContaining(['red', 'blue']));
    expect(res.body.data.items.every((a) => a.key !== 'material')).toBe(true);
  });

  it('lists the channels offering a currency when one is asked', async () => {
    const all = await api.get<Items<{ id: string; currencies: string[] }>>('/api/v1/admin/price-books/targets/sales-channels');
    expect(all.body.data.items.map((c) => c.id)).toEqual(expect.arrayContaining([f.channels.CH1.id, f.channels.CH3.id]));
    const eur = await api.get<Items<{ id: string }>>('/api/v1/admin/price-books/targets/sales-channels?currency=EUR');
    const ids = eur.body.data.items.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([f.channels.CH2.id, f.channels.CH3.id]));
    expect(ids).not.toContain(f.channels.CH1.id);
  });

  it('lists organizations, customer groups, categories and currencies', async () => {
    const orgs = await api.get<Items<{ id: string }>>(`/api/v1/admin/price-books/targets/organizations?search=Acme`);
    expect(orgs.body.data.items.map((o) => o.id)).toContain(f.orgs.Acme.id);
    const groups = await api.get<Items<{ id: string }>>('/api/v1/admin/price-books/targets/customer-groups');
    expect(groups.body.data.items.map((g) => g.id)).toEqual(expect.arrayContaining([f.groups.VIP, f.groups.Gold]));
    const categories = await api.get<Items<{ id: string }>>('/api/v1/admin/price-books/targets/categories');
    expect(categories.body.data.items.map((c) => c.id)).toEqual(expect.arrayContaining([f.categories.screws, f.categories.bolts]));
    const currencies = await api.get<Items<{ code: string }>>('/api/v1/admin/price-books/targets/currencies');
    expect(currencies.body.data.items.map((c) => c.code)).toEqual(expect.arrayContaining(['PLN', 'EUR']));
  });

  it('answers every picker in the shape of its contracts schema (161 T045)', async () => {
    // The editor's API client parses each answer through these schemas, so a
    // field renamed here and not there is a refusal in the browser — this case
    // is what keeps the two in step (Principle II).
    const cases = [
      ['/api/v1/admin/price-books/targets/organizations?search=Acme', priceBookTargetOrganizationsResponseSchema],
      [`/api/v1/admin/price-books/targets/organizations?ids=${f.orgs.Acme.id}`, priceBookTargetOrganizationsResponseSchema],
      ['/api/v1/admin/price-books/targets/customer-groups', priceBookTargetCustomerGroupsResponseSchema],
      ['/api/v1/admin/price-books/targets/categories', priceBookTargetCategoriesResponseSchema],
      ['/api/v1/admin/price-books/targets/attributes', priceBookTargetAttributesResponseSchema],
      ['/api/v1/admin/price-books/targets/sales-channels', priceBookTargetSalesChannelsResponseSchema],
      ['/api/v1/admin/price-books/targets/sales-channels?currency=EUR', priceBookTargetSalesChannelsResponseSchema],
      ['/api/v1/admin/price-books/targets/currencies', priceBookTargetCurrenciesResponseSchema],
    ] as const;
    for (const [path, schema] of cases) {
      const res = await api.get<unknown>(path);
      expect(res.status, `${path}: ${res.raw}`).toBe(200);
      const parsed = schema.safeParse(res.body);
      expect(parsed.success, `${path}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
      expect((res.body as { data: { items: unknown[] } }).data.items.length, path).toBeGreaterThan(0);
    }
  });

  it('offers a representative only the organizations in their scope', async () => {
    const res = await api.get<Items<{ id: string }>>('/api/v1/admin/price-books/targets/organizations?limit=200', rep.cookies);
    expect(res.status, res.raw).toBe(200);
    const ids = res.body.data.items.map((o) => o.id);
    expect(ids).toContain(f.orgs.Acme.id);
    expect(ids).not.toContain(f.orgs.Beta.id);
  });
});
