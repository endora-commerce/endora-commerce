import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBook, PriceBookSummary } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 160 (US7, T089) — the book routes of
 * `specs/160-pricing-model-v2/contracts/admin-price-books-api.md`: list with
 * its filters, create, read, patch (currency immutable, audience kind fixed
 * once activated, the version a patch is made against — G5), activate and
 * draftify, delete; and the list filtered by product (G1) with each book's
 * tier starts (G4). FR-001–FR-004, FR-033.
 */
describe('admin price-book routes (feature 160 US7)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;

  type Envelope<T> = { data: T };
  type ErrorEnvelope = { error: { code: string; message: string; details?: Record<string, unknown> } };

  const create = async (overrides: Record<string, unknown> = {}) =>
    api.post<Envelope<PriceBook>>('/api/v1/admin/price-books', {
      name: 'Contract book',
      type: 'regular',
      currencyCode: 'PLN',
      channelIds: [f.channels.CH1.id],
      audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id] },
      ...overrides,
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates a draft at version 1, with its channel bindings and no tier yet', async () => {
    const res = await create();
    expect(res.status, res.raw).toBe(201);
    const book = res.body.data;
    expect(book).toMatchObject({
      name: 'Contract book',
      type: 'regular',
      status: 'draft',
      currencyCode: 'PLN',
      audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id] },
      isSystem: false,
      everActivated: false,
      version: 1,
      tierStarts: [],
      rowCount: 0,
      channels: [{ channelId: f.channels.CH1.id, dormant: false }],
    });
  });

  it('refuses a channel that does not offer the currency, naming the channel (FR-003)', async () => {
    const res = await create({ currencyCode: 'PLN', channelIds: [f.channels.CH3.id] });
    expect(res.status).toBe(400);
    const error = (res.body as unknown as ErrorEnvelope).error;
    expect(error.code).toBe('PRICE_BOOK_CHANNEL_CURRENCY');
    // The sentence is the bundle's; the channel the refusal names is in the details.
    expect(JSON.stringify(error.details)).toContain(f.channels.CH3.code);
  });

  it('refuses an audience set that mixes kinds (A4)', async () => {
    const res = await create({ audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id, f.groups.VIP] } });
    expect(res.status).toBe(400);
    expect((res.body as unknown as ErrorEnvelope).error.code).toBe('PRICE_BOOK_AUDIENCE_KIND');
  });

  it('reads a book, and answers an unknown one 404', async () => {
    const created = (await create({ name: 'Readable' })).body.data;
    const res = await api.get<Envelope<PriceBook>>(`/api/v1/admin/price-books/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: created.id, name: 'Readable', version: 1 });
    const missing = await api.get(`/api/v1/admin/price-books/00000000-0000-4000-8000-0000001600ff`);
    expect(missing.status).toBe(404);
  });

  it('lists books with every filter, and the base books once per currency', async () => {
    const sale = (
      await create({
        name: 'Filter sale',
        type: 'sale',
        audience: { kind: 'customer_groups', memberIds: [f.groups.Gold] },
        channelIds: [f.channels.CH2.id],
      })
    ).body.data;
    const list = async (query: string) =>
      (await api.get<{ data: PriceBookSummary[]; meta: { totalCount: number } }>(`/api/v1/admin/price-books?${query}`))
        .body;
    expect((await list('type=sale')).data.map((b) => b.id)).toContain(sale.id);
    expect((await list('type=regular')).data.map((b) => b.id)).not.toContain(sale.id);
    expect((await list(`channelId=${f.channels.CH2.id}`)).data.map((b) => b.id)).toContain(sale.id);
    expect((await list(`channelId=${f.channels.CH1.id}`)).data.map((b) => b.id)).not.toContain(sale.id);
    expect((await list('audienceKind=customer_groups')).data.map((b) => b.id)).toContain(sale.id);
    expect((await list(`memberId=${f.groups.Gold}`)).data.map((b) => b.id)).toEqual([sale.id]);
    expect((await list('search=Filter%20sa')).data.map((b) => b.id)).toEqual([sale.id]);
    expect((await list('status=active')).data.map((b) => b.id)).not.toContain(sale.id);
    const summary = (await list(`memberId=${f.groups.Gold}`)).data[0]!;
    expect(summary).toMatchObject({ channelCount: 1, memberCount: 1, rowCount: 0, appliesToNoOne: false, appliesNowhere: false });
    const base = (await list('currency=PLN')).data.filter((b) => b.isSystem);
    expect(base).toHaveLength(1);
    const page = await list('pageSize=1&page=1');
    expect(page.data).toHaveLength(1);
    expect(page.meta.totalCount).toBeGreaterThan(1);
  });

  it('patches the header against the version it read, and refuses a stale one with the current version (G5)', async () => {
    const book = (await create({ name: 'Patchable' })).body.data;
    const ok = await api.patch<Envelope<PriceBook>>(`/api/v1/admin/price-books/${book.id}`, {
      name: 'Patched',
      priority: 7,
      expectedVersion: 1,
    });
    expect(ok.status, ok.raw).toBe(200);
    expect(ok.body.data).toMatchObject({ name: 'Patched', priority: 7, version: 2 });

    const stale = await api.patch(`/api/v1/admin/price-books/${book.id}`, { name: 'Again', expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect((stale.body as ErrorEnvelope).error).toMatchObject({
      code: 'PRICE_BOOK_STALE',
      details: { currentVersion: 2 },
    });

    const viaHeader = await api.patch<Envelope<PriceBook>>(
      `/api/v1/admin/price-books/${book.id}`,
      { name: 'Header' },
      undefined,
      { 'if-match': '"2"' },
    );
    expect(viaHeader.status, viaHeader.raw).toBe(200);
    expect(viaHeader.body.data.version).toBe(3);

    const unversioned = await api.patch(`/api/v1/admin/price-books/${book.id}`, { name: 'Blind' });
    expect(unversioned.status).toBe(400);
  });

  it('refuses a currency change, and an audience-kind change once the book was active (FR-004)', async () => {
    const book = (await create({ name: 'Immutable' })).body.data;
    const currency = await api.patch(`/api/v1/admin/price-books/${book.id}`, { currencyCode: 'EUR', expectedVersion: 1 });
    expect(currency.status).toBe(409);
    expect((currency.body as ErrorEnvelope).error.code).toBe('PRICE_BOOK_IMMUTABLE_FIELD');

    // A draft that was never active may change its audience kind.
    const kind = await api.patch<Envelope<PriceBook>>(`/api/v1/admin/price-books/${book.id}`, {
      audience: { kind: 'customer_groups', memberIds: [f.groups.VIP] },
      expectedVersion: 1,
    });
    expect(kind.status, kind.raw).toBe(200);
    expect(kind.body.data.audience.kind).toBe('customer_groups');

    const activated = await api.post<Envelope<PriceBook>>(`/api/v1/admin/price-books/${book.id}/activate`);
    expect(activated.status, activated.raw).toBe(200);
    expect(activated.body.data).toMatchObject({ status: 'active', everActivated: true });
    const drafted = await api.post<Envelope<PriceBook>>(`/api/v1/admin/price-books/${book.id}/draftify`);
    expect(drafted.status, drafted.raw).toBe(200);
    expect(drafted.body.data).toMatchObject({ status: 'draft', everActivated: true });

    const late = await api.patch(`/api/v1/admin/price-books/${book.id}`, {
      audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id] },
      expectedVersion: drafted.body.data.version,
    });
    expect(late.status).toBe(409);
    expect((late.body as ErrorEnvelope).error.code).toBe('PRICE_BOOK_IMMUTABLE_FIELD');
    // The members of the same kind still change.
    const members = await api.patch<Envelope<PriceBook>>(`/api/v1/admin/price-books/${book.id}`, {
      audience: { kind: 'customer_groups', memberIds: [f.groups.VIP, f.groups.Gold] },
      expectedVersion: drafted.body.data.version,
    });
    expect(members.status, members.raw).toBe(200);
    expect([...members.body.data.audience.memberIds].sort()).toEqual([f.groups.VIP, f.groups.Gold].sort());
  });

  it('refuses to activate a book that applies nowhere or to no one (PRICE_BOOK_NOT_APPLICABLE)', async () => {
    const nowhere = (await create({ name: 'Nowhere', channelIds: [] })).body.data;
    const res = await api.post(`/api/v1/admin/price-books/${nowhere.id}/activate`);
    expect(res.status).toBe(409);
    expect((res.body as ErrorEnvelope).error.code).toBe('PRICE_BOOK_NOT_APPLICABLE');
    const noOne = (await create({ name: 'No one', audience: { kind: 'organizations', memberIds: [] } })).body.data;
    const res2 = await api.post(`/api/v1/admin/price-books/${noOne.id}/activate`);
    expect(res2.status).toBe(409);
    expect((res2.body as ErrorEnvelope).error.code).toBe('PRICE_BOOK_NOT_APPLICABLE');
    const list = (await api.get<{ data: PriceBookSummary[] }>(`/api/v1/admin/price-books?search=No%20one`)).body.data;
    expect(list[0]).toMatchObject({ appliesToNoOne: true });
    const list2 = (await api.get<{ data: PriceBookSummary[] }>(`/api/v1/admin/price-books?search=Nowhere`)).body.data;
    expect(list2[0]).toMatchObject({ appliesNowhere: true });
  });

  it('deletes a book, and refuses the base book 403', async () => {
    const book = (await create({ name: 'Doomed' })).body.data;
    const res = await api.delete(`/api/v1/admin/price-books/${book.id}`);
    expect(res.status).toBe(204);
    expect((await api.get(`/api/v1/admin/price-books/${book.id}`)).status).toBe(404);
    const base = (await api.get<{ data: PriceBookSummary[] }>('/api/v1/admin/price-books?currency=PLN')).body.data.find(
      (b) => b.isSystem,
    )!;
    const refused = await api.delete(`/api/v1/admin/price-books/${base.id}`);
    expect(refused.status).toBe(403);
  });

  it('lists the books that price a product directly, with the matching rows and every book’s tier starts (G1, G4)', async () => {
    const { id } = await f.book({
      name: 'G1 product book',
      audience: { organizations: [f.orgs.Beta] },
      rows: [
        { product: f.products.P2, max: 9, fixed: '45' },
        { product: f.products.P2, min: 10, fixed: '40' },
        { category: f.categories.screws, min: 50, percent: '-10' },
      ],
    });
    const variantBook = await f.book({
      name: 'G1 variant book',
      audience: 'everyone',
      rows: [{ product: f.products.P5, variant: f.variants.P5b, fixed: '70' }],
    });
    const res = await api.get<{ data: PriceBookSummary[] }>(`/api/v1/admin/price-books?productId=${f.products.P2.id}`);
    expect(res.status, res.raw).toBe(200);
    const mine = res.body.data.find((b) => b.id === id)!;
    expect(mine.tierStarts).toEqual([1, 10, 50]);
    expect(mine.matches).toEqual([
      expect.objectContaining({ selectionKind: 'product', minQuantity: 1, maxQuantity: 9, price: { type: 'fixed', amount: '45.0000' } }),
      expect.objectContaining({ selectionKind: 'product', minQuantity: 10, price: { type: 'fixed', amount: '40.0000' } }),
    ]);
    expect(res.body.data.map((b) => b.id)).not.toContain(variantBook.id);
    // The base book prices P2 directly too.
    expect(res.body.data.some((b) => b.isSystem)).toBe(true);

    const byVariant = await api.get<{ data: PriceBookSummary[] }>(
      `/api/v1/admin/price-books?productId=${f.products.P5.id}&variantId=${f.variants.P5b}`,
    );
    const variantMatch = byVariant.body.data.find((b) => b.id === variantBook.id)!;
    expect(variantMatch.matches).toEqual([expect.objectContaining({ selectionKind: 'variant', price: { type: 'fixed', amount: '70.0000' } })]);

    const read = await api.get<Envelope<PriceBook>>(`/api/v1/admin/price-books/${id}`);
    expect(read.body.data.tierStarts).toEqual([1, 10, 50]);
  });
});
