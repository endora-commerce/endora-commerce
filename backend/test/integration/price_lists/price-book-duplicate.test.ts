import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBook, PriceBookRow } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 160 (US7, T092, FR-036) — duplicating a book: a draft with its own
 * name, channel set, currency and audience, the fixed and amount rows
 * multiplied half-up to four places, the percentages copied verbatim, one
 * audit entry; and the channel set validated against the new currency.
 */
describe('price_lists — duplicate a price book (feature 160 US7)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let sourceId: string;

  type Envelope<T> = { data: T };

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    sourceId = (
      await f.book({
        name: 'Source',
        audience: { organizations: [f.orgs.Acme] },
        rows: [
          { product: f.products.P1, fixed: '10.0001' },
          { product: f.products.P2, amount: '-3.3333' },
          { category: f.categories.screws, percent: '-5.5' },
        ],
      })
    ).id;
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('copies into a draft in another currency, multiplying amounts half-up and keeping percentages', async () => {
    const before = await h.em().count(AuditLogEntry, { action: 'price_list.duplicate' });
    const res = await api.post<Envelope<PriceBook>>(`/api/v1/admin/price-books/${sourceId}/duplicate`, {
      name: 'Copy EUR',
      channelIds: [f.channels.CH2.id],
      currencyCode: 'EUR',
      audience: { kind: 'organizations', memberIds: [f.orgs.Beta.id] },
      amountMultiplier: '0.25',
    });
    expect(res.status, res.raw).toBe(201);
    const copy = res.body.data;
    expect(copy).toMatchObject({
      name: 'Copy EUR',
      status: 'draft',
      currencyCode: 'EUR',
      audience: { kind: 'organizations', memberIds: [f.orgs.Beta.id] },
      channels: [{ channelId: f.channels.CH2.id, dormant: false }],
      everActivated: false,
    });
    expect(await h.em().count(AuditLogEntry, { action: 'price_list.duplicate', objectId: copy.id })).toBe(1);
    expect(await h.em().count(AuditLogEntry, { action: 'price_list.duplicate' })).toBe(before + 1);
    const rows = (await api.get<{ data: PriceBookRow[] }>(`/api/v1/admin/price-books/${copy.id}/rows`)).body.data;
    const bySelection = (kind: string, productId?: string) =>
      rows.find((r) => r.selectionKind === kind && (productId === undefined || r.selection.productId === productId))!;
    // 10.0001 × 0.25 = 2.500025 → 2.5000 (half-up at the fifth place).
    expect(bySelection('product', f.products.P1.id).price).toEqual({ type: 'fixed', amount: '2.5000' });
    // −3.3333 × 0.25 = −0.833325 → −0.8333.
    expect(bySelection('product', f.products.P2.id).price).toEqual({ type: 'amount', amount: '-0.8333' });
    expect(bySelection('category').price).toEqual({ type: 'percent', percent: '-5.50' });
    // The source is untouched.
    const source = (await api.get<{ data: PriceBookRow[] }>(`/api/v1/admin/price-books/${sourceId}/rows`)).body.data;
    expect(source.find((r) => r.selection.productId === f.products.P1.id)!.price).toEqual({ type: 'fixed', amount: '10.0001' });
  });

  it('rounds half up on a tie', async () => {
    const tie = await f.book({ name: 'Tie', audience: 'everyone', rows: [{ product: f.products.P3, fixed: '0.0001' }] });
    const res = await api.post<Envelope<PriceBook>>(`/api/v1/admin/price-books/${tie.id}/duplicate`, {
      name: 'Tie copy',
      channelIds: [f.channels.CH1.id],
      currencyCode: 'PLN',
      audience: { kind: 'everyone', memberIds: [] },
      amountMultiplier: '1.5',
    });
    expect(res.status, res.raw).toBe(201);
    const rows = (await api.get<{ data: PriceBookRow[] }>(`/api/v1/admin/price-books/${res.body.data.id}/rows`)).body.data;
    // 0.0001 × 1.5 = 0.00015 → 0.0002.
    expect(rows[0]!.price).toEqual({ type: 'fixed', amount: '0.0002' });
  });

  it('refuses a channel that does not offer the new currency, writing nothing', async () => {
    const before = await h.em().count(AuditLogEntry, { action: 'price_list.duplicate' });
    const res = await api.post(`/api/v1/admin/price-books/${sourceId}/duplicate`, {
      name: 'Bad copy',
      channelIds: [f.channels.CH1.id],
      currencyCode: 'EUR',
      audience: { kind: 'organizations', memberIds: [f.orgs.Beta.id] },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('PRICE_BOOK_CHANNEL_CURRENCY');
    expect(await h.em().count(AuditLogEntry, { action: 'price_list.duplicate' })).toBe(before);
  });
});
