import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBook, PriceBookSummary } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { createSalesRep, priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 160 (US7, T093, FR-034, SC-008) — a sales representative and price
 * books, replacing feature 148's `price-matrix-tenant-scope`.
 *
 * Assigned to Acme only (Beta belongs to another representative):
 *
 * - A3.1 an organization book naming only Acme is theirs to read and edit;
 * - A3.2 a book naming Acme **and** Beta, or Beta alone, does not exist for
 *   them — the status and body of an unknown id, absent from lists and counts;
 * - A3.3 everyone and customer-group books are readable and read-only (403);
 * - A4 they cannot add an out-of-scope member, which answers as an unknown one.
 */
describe('price_lists — price books and a sales representative’s scope (feature 160 US7)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let rep: Awaited<ReturnType<typeof createSalesRep>>;
  let own: string;
  let mixed: string;
  let foreign: string;
  let everyone: string;
  let groups: string;

  const UNKNOWN = '00000000-0000-4000-8000-0000001600cc';
  type ErrorEnvelope = { error: Record<string, unknown> };
  const refusal = (body: unknown): unknown => {
    const { requestId: _requestId, message: _message, ...rest } = (body as ErrorEnvelope).error;
    return rest;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    rep = await createSalesRep(h, {
      assignedOrganizationIds: [f.orgs.Acme.id],
      otherOrganizationIds: [f.orgs.Beta.id, f.orgs.Gamma.id, f.orgs.AcmeW.id],
    });
    own = (await f.book({ name: 'Scope own', audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, fixed: '90' }] })).id;
    mixed = (await f.book({ name: 'Scope mixed', audience: { organizations: [f.orgs.Acme, f.orgs.Beta] } })).id;
    foreign = (await f.book({ name: 'Scope foreign', audience: { organizations: [f.orgs.Beta] } })).id;
    everyone = (await f.book({ name: 'Scope everyone', audience: 'everyone' })).id;
    groups = (await f.book({ name: 'Scope groups', audience: { groups: [f.groups.VIP] } })).id;
  }, 5 * 60_000);

  afterAll(async () => {
    rep.release();
    await teardownBackendServer(h);
  });

  it('A3.2 — an out-of-scope book answers exactly as an unknown one, on every route', async () => {
    for (const id of [mixed, foreign]) {
      for (const [method, suffix, body] of [
        ['get', '', undefined],
        ['get', '/rows', undefined],
        ['patch', '', { name: 'x', expectedVersion: 1 }],
        ['put', '/rows', { expectedVersion: 1, upsert: [] }],
        ['post', '/activate', {}],
        ['post', '/draftify', {}],
        ['post', '/duplicate', { name: 'x', channelIds: [], currencyCode: 'PLN', audience: { kind: 'everyone', memberIds: [] } }],
        ['delete', '', undefined],
      ] as const) {
        const call = (target: string) =>
          method === 'get' || method === 'delete'
            ? api[method](`/api/v1/admin/price-books/${target}${suffix}`, rep.cookies)
            : api[method](`/api/v1/admin/price-books/${target}${suffix}`, body, rep.cookies);
        const hidden = await call(id);
        const unknown = await call(UNKNOWN);
        expect(hidden.status, `${method} ${suffix}`).toBe(404);
        expect(unknown.status, `${method} ${suffix}`).toBe(404);
        expect(refusal(hidden.body), `${method} ${suffix}`).toEqual(refusal(unknown.body));
        expect(hidden.raw).not.toContain(id);
      }
    }
  });

  it('A3.2 — lists and counts leave the hidden books out', async () => {
    const res = await api.get<{ data: PriceBookSummary[]; meta: { totalCount: number } }>(
      '/api/v1/admin/price-books?search=Scope&pageSize=100',
      rep.cookies,
    );
    expect(res.status, res.raw).toBe(200);
    const ids = res.body.data.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining([own, everyone, groups]));
    expect(ids).not.toContain(mixed);
    expect(ids).not.toContain(foreign);
    expect(res.body.meta.totalCount).toBe(3);
    const byProduct = await api.get<{ data: PriceBookSummary[] }>(
      `/api/v1/admin/price-books?productId=${f.products.P1.id}`,
      rep.cookies,
    );
    expect(byProduct.body.data.map((b) => b.id)).not.toContain(mixed);
    const byMember = await api.get<{ data: PriceBookSummary[]; meta: { totalCount: number } }>(
      `/api/v1/admin/price-books?memberId=${f.orgs.Beta.id}`,
      rep.cookies,
    );
    expect(byMember.body.meta.totalCount).toBe(0);
  });

  it('A3.1 — the representative edits a book of their own organizations', async () => {
    const book = (await api.get<{ data: PriceBook }>(`/api/v1/admin/price-books/${own}`, rep.cookies)).body.data;
    const res = await api.patch<{ data: PriceBook }>(
      `/api/v1/admin/price-books/${own}`,
      { name: 'Scope own (renamed)', expectedVersion: book.version },
      rep.cookies,
    );
    expect(res.status, res.raw).toBe(200);
    const rows = await api.put(
      `/api/v1/admin/price-books/${own}/rows`,
      { expectedVersion: res.body.data.version, upsert: [{ selection: { productId: f.products.P2.id }, minQuantity: 1, price: { type: 'fixed', amount: '44' } }] },
      rep.cookies,
    );
    expect(rows.status, rows.raw).toBe(200);
  });

  it('A3.3 — everyone and customer-group books are read-only for a representative', async () => {
    for (const id of [everyone, groups]) {
      const read = await api.get<{ data: PriceBook }>(`/api/v1/admin/price-books/${id}`, rep.cookies);
      expect(read.status).toBe(200);
      const write = await api.patch(`/api/v1/admin/price-books/${id}`, { name: 'x', expectedVersion: read.body.data.version }, rep.cookies);
      expect(write.status).toBe(403);
      const rows = await api.put(`/api/v1/admin/price-books/${id}/rows`, { expectedVersion: read.body.data.version, upsert: [] }, rep.cookies);
      expect(rows.status).toBe(403);
    }
    const created = await api.post(
      '/api/v1/admin/price-books',
      { name: 'Rep everyone', type: 'regular', currencyCode: 'PLN', channelIds: [f.channels.CH1.id], audience: { kind: 'everyone', memberIds: [] } },
      rep.cookies,
    );
    expect(created.status).toBe(403);
  });

  it('A4 — an out-of-scope member answers as an unknown one', async () => {
    const book = (await api.get<{ data: PriceBook }>(`/api/v1/admin/price-books/${own}`, rep.cookies)).body.data;
    const out = await api.patch(
      `/api/v1/admin/price-books/${own}`,
      { audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id, f.orgs.Beta.id] }, expectedVersion: book.version },
      rep.cookies,
    );
    const unknown = await api.patch(
      `/api/v1/admin/price-books/${own}`,
      { audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id, UNKNOWN] }, expectedVersion: book.version },
      rep.cookies,
    );
    expect(out.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect((out.body as ErrorEnvelope).error['code']).toBe((unknown.body as ErrorEnvelope).error['code']);
    const created = await api.post(
      '/api/v1/admin/price-books',
      { name: 'Rep foreign', type: 'regular', currencyCode: 'PLN', channelIds: [f.channels.CH1.id], audience: { kind: 'organizations', memberIds: [f.orgs.Beta.id] } },
      rep.cookies,
    );
    expect(created.status).toBe(400);
  });

  it('a platform administrator sees every book', async () => {
    const res = await api.get<{ data: PriceBookSummary[] }>('/api/v1/admin/price-books?search=Scope&pageSize=100');
    expect(res.body.data.map((b) => b.id)).toEqual(expect.arrayContaining([own, mixed, foreign, everyone, groups]));
  });
});
