import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBook, PriceBookListResponse, ProductBasePrices } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { createSalesRep, priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 161, G11 (`specs/161-price-book-editor/contracts/backend-gaps.md`) —
 * the admin API says whether the caller may change what it answers, because
 * the browser does not know the caller's organization scope: `writable` on a
 * book and on every line of the book list, the audience kinds the caller may
 * create (`meta.creatableAudienceKinds`), and `writable` on a product's base
 * prices. The rule is P1's (`price-book-scope.ts`); this asserts it reaches the
 * wire for a platform administrator and for a representative scoped to {Acme}.
 */
describe('price books — writable for the caller (161 G11)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let rep: Awaited<ReturnType<typeof createSalesRep>>;
  let acmeBook: string;
  let everyoneBook: string;
  let groupBook: string;
  let baseBookId: string;

  type Envelope<T> = { data: T };
  type ListAnswer = PriceBookListResponse & { meta: { creatableAudienceKinds: string[] } };

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    rep = await createSalesRep(h, { assignedOrganizationIds: [f.orgs.Acme.id], otherOrganizationIds: [f.orgs.Beta.id] });
    acmeBook = (await f.book({ name: 'G11 Acme', audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, percent: '-5' }] })).id;
    everyoneBook = (await f.book({ name: 'G11 everyone', audience: 'everyone', rows: [{ product: f.products.P2, fixed: '45' }] })).id;
    groupBook = (await f.book({ name: 'G11 VIP', audience: { groups: [f.groups.VIP] }, rows: [{ product: f.products.P1, fixed: '92' }] })).id;
    const base = await api.get<Envelope<ProductBasePrices>>(`/api/v1/admin/price-books/base-prices?productId=${f.products.P1.id}`);
    baseBookId = base.body.data.byCurrency['PLN']!.bookId;
  }, 5 * 60_000);

  afterAll(async () => {
    rep.release();
    await teardownBackendServer(h);
  });

  const book = (id: string, cookies?: Record<string, string>) => api.get<Envelope<PriceBook & { writable: boolean }>>(`/api/v1/admin/price-books/${id}`, cookies);
  const list = (cookies?: Record<string, string>) => api.get<ListAnswer>('/api/v1/admin/price-books?pageSize=200', cookies);

  it('a platform administrator may change every book, create every kind and write base prices', async () => {
    for (const id of [acmeBook, everyoneBook, groupBook, baseBookId]) {
      const res = await book(id);
      expect(res.status, res.raw).toBe(200);
      expect(res.body.data.writable).toBe(true);
    }
    const res = await list();
    expect(res.status, res.raw).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const summary of res.body.data) expect((summary as { writable?: unknown }).writable).toBe(true);
    expect([...res.body.meta.creatableAudienceKinds].sort()).toEqual(['customer_groups', 'everyone', 'organizations']);
    const base = await api.get<Envelope<ProductBasePrices & { writable: boolean }>>(`/api/v1/admin/price-books/base-prices?productId=${f.products.P1.id}`);
    expect(base.status, base.raw).toBe(200);
    expect(base.body.data.writable).toBe(true);
  });

  it('a representative scoped to {Acme} may change the Acme book only, create organization books only, and reads base prices', async () => {
    expect((await book(acmeBook, rep.cookies)).body.data.writable).toBe(true);
    expect((await book(everyoneBook, rep.cookies)).body.data.writable).toBe(false);
    expect((await book(groupBook, rep.cookies)).body.data.writable).toBe(false);
    const baseRead = await book(baseBookId, rep.cookies);
    expect(baseRead.status, baseRead.raw).toBe(200);
    expect(baseRead.body.data.writable).toBe(false);

    const res = await list(rep.cookies);
    expect(res.status, res.raw).toBe(200);
    const byId = new Map(res.body.data.map((s) => [s.id, (s as { writable?: unknown }).writable]));
    expect(byId.get(acmeBook)).toBe(true);
    expect(byId.get(everyoneBook)).toBe(false);
    expect(byId.get(groupBook)).toBe(false);
    expect(byId.get(baseBookId)).toBe(false);
    expect(res.body.meta.creatableAudienceKinds).toEqual(['organizations']);

    const base = await api.get<Envelope<ProductBasePrices & { writable: boolean }>>(
      `/api/v1/admin/price-books/base-prices?productId=${f.products.P1.id}`,
      rep.cookies,
    );
    expect(base.status, base.raw).toBe(200);
    expect(base.body.data.writable).toBe(false);
  });

  it('the flag agrees with the write it predicts', async () => {
    const readOnly = await book(everyoneBook, rep.cookies);
    const refused = await api.patch(`/api/v1/admin/price-books/${everyoneBook}`, { name: 'x', expectedVersion: readOnly.body.data.version }, rep.cookies);
    expect(refused.status).toBe(403);
    const writable = await book(acmeBook, rep.cookies);
    const accepted = await api.patch(`/api/v1/admin/price-books/${acmeBook}`, { name: 'G11 Acme renamed', expectedVersion: writable.body.data.version }, rep.cookies);
    expect(accepted.status, accepted.raw).toBe(200);
    expect((accepted.body as Envelope<{ writable: boolean }>).data.writable).toBe(true);
  });
});
