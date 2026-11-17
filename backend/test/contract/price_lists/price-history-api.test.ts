import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  priceBookHistoryChangesResponseSchema,
  priceBookHistoryLinesResponseSchema,
  priceBookHistoryProductLinesResponseSchema,
  type PriceBook,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Issue #470 stage 3 — every price-history answer parses with its contract
 * schema (`packages/contracts/src/price-books.ts`, *Price history*), strictly:
 * a key the schema does not name is a contract change. Keyset envelope
 * `{ data, pagination }`, never the price-book API's `meta`.
 */
describe('price-book price history — answers match their schemas (#470, stage 3)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let book: PriceBook;
  const B = '/api/v1/admin/price-books';

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    const created = await api.post<{ data: PriceBook }>(B, {
      name: 'S470-CONTRACT',
      type: 'regular',
      currencyCode: 'PLN',
      channelIds: [f.channels.CH1.id],
      audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id] },
    });
    expect(created.status, created.raw).toBe(201);
    book = created.body.data;
    const rows = await api.put(`${B}/${book.id}/rows`, {
      expectedVersion: book.version,
      upsert: [
        { selection: { productId: f.products.P5.id }, minQuantity: 1, price: { type: 'fixed', amount: '0.0125' } },
        { selection: { productId: f.products.P5.id, variantId: f.variants.P5b }, minQuantity: 1, price: { type: 'amount', amount: '-1.2345' } },
        { selection: { categoryId: f.categories.screws }, minQuantity: 1, price: { type: 'percent', percent: '-5' } },
      ],
    });
    expect(rows.status, rows.raw).toBe(200);
  }, 5 * 60_000);

  afterAll(async () => {
    if (book) await h.em().fork().getConnection().execute(`delete from "price_lists" where "id" = ?`, [book.id]);
    await teardownBackendServer(h);
  });

  it('GET …/:id/price-history', async () => {
    const res = await api.get(`${B}/${book.id}/price-history?limit=1`);
    expect(res.status, res.raw).toBe(200);
    const parsed = priceBookHistoryChangesResponseSchema.strict().parse(res.body);
    expect(parsed.pagination).toMatchObject({ hasMore: true, limit: 1 });
    expect(parsed.pagination.cursor).toEqual(expect.any(String));
    for (const change of parsed.data) priceBookHistoryChangesResponseSchema.shape.data.element.strict().parse(change);
  });

  it('GET …/:id/price-history/:changeId/lines', async () => {
    const changes = priceBookHistoryChangesResponseSchema.parse((await api.get(`${B}/${book.id}/price-history`)).body);
    const rows = changes.data.find((c) => c.action === 'price_list.rows_replace')!;
    const res = await api.get(`${B}/${book.id}/price-history/${rows.id}/lines`);
    expect(res.status, res.raw).toBe(200);
    const parsed = priceBookHistoryLinesResponseSchema.strict().parse(res.body);
    expect(parsed.data).toHaveLength(3);
    for (const line of parsed.data) priceBookHistoryLinesResponseSchema.shape.data.element.strict().parse(line);
  });

  it('GET …/:id/price-history/products/:productId', async () => {
    const res = await api.get(`${B}/${book.id}/price-history/products/${f.products.P5.id}`);
    expect(res.status, res.raw).toBe(200);
    const parsed = priceBookHistoryProductLinesResponseSchema.strict().parse(res.body);
    expect(parsed.data.map((l) => l.selection.variantId).sort()).toEqual([null, f.variants.P5b].sort());
    expect(parsed.data.every((l) => l.selection.categoryId === null)).toBe(true);
    for (const line of parsed.data) priceBookHistoryProductLinesResponseSchema.shape.data.element.strict().parse(line);
  });
});
