import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Migration20261022T182527PriceListsProductLines } from '@endora-commerce/mod-price-lists/migrations';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 161, G15 redesign (`research.md` R14) — `price_list_product_lines`
 * holds one row per product line of a book (a product with product or variant
 * rows), so the lines read counts and probes a book's products from unique
 * keys instead of every matrix row. It must always equal
 * `select distinct price_list_id, product_id` of `price_list_matrix_entries`:
 * every `price_lists` write maintains it in its own transaction, a product
 * hard delete cascades, the catalogue's variant delete is reconciled from its
 * event, and the migration backfills it.
 */
describe('price_list_product_lines (161 G15)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  const sql = <T = Record<string, unknown>>(statement: string, params: unknown[] = []) =>
    h.em().getConnection().execute<T[]>(statement, params);

  type Pair = { price_list_id: string; product_id: string };
  const order = (rows: Pair[]) => rows.map((r) => `${r.price_list_id}|${r.product_id}`).sort();
  const expectInSync = async (what: string) => {
    const expected = await sql<Pair>(`select distinct "price_list_id", "product_id" from "price_list_matrix_entries" where "product_id" is not null`);
    const actual = await sql<Pair>(`select "price_list_id", "product_id" from "price_list_product_lines"`);
    expect(order(actual), what).toEqual(order(expected));
  };
  const linesOf = async (bookId: string) =>
    (await sql<{ product_id: string }>(`select "product_id" from "price_list_product_lines" where "price_list_id" = ?`, [bookId])).map((r) => r.product_id).sort();
  const version = async (id: string) => (await api.get<{ data: { version: number } }>(`/api/v1/admin/price-books/${id}`)).body.data.version;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('starts in sync, the fixture written through the service', async () => {
    await expectInSync('fixture');
  });

  it('a batch adds product and variant lines, and deleting a line’s last row removes it', async () => {
    const book = await f.book({
      name: 'G15 lines',
      audience: 'everyone',
      activate: false,
      rows: [
        { product: f.products.P1, fixed: '90', max: 9 },
        { product: f.products.P1, fixed: '85', min: 10 },
        { product: f.products.P5, variant: f.variants.P5r, percent: '-1' },
        { category: f.categories.screws, percent: '-3' },
      ],
    });
    expect(await linesOf(book.id)).toEqual([f.products.P1.id, f.products.P5.id].sort());
    await expectInSync('after the batch');

    const one = await api.put(`/api/v1/admin/price-books/${book.id}/rows`, { expectedVersion: await version(book.id), delete: [book.rowIds[0]] });
    expect(one.status, one.raw).toBe(200);
    expect(await linesOf(book.id)).toEqual([f.products.P1.id, f.products.P5.id].sort());
    const last = await api.put(`/api/v1/admin/price-books/${book.id}/rows`, { expectedVersion: await version(book.id), delete: [book.rowIds[1], book.rowIds[2]] });
    expect(last.status, last.raw).toBe(200);
    expect(await linesOf(book.id)).toEqual([]);
    await expectInSync('after the deletes');

    const replaced = await api.put(`/api/v1/admin/price-books/${book.id}/rows`, {
      expectedVersion: await version(book.id),
      mode: 'replace',
      upsert: [{ selection: { productId: f.products.P2.id }, minQuantity: 1, price: { type: 'fixed', amount: '1' } }],
    });
    expect(replaced.status, replaced.raw).toBe(200);
    expect(await linesOf(book.id)).toEqual([f.products.P2.id]);
    await expectInSync('after a replace');
  });

  it('a base-price write, a duplicate and a book delete keep it in sync', async () => {
    await f.setBase(f.products.P4, { product: [{ minQuantity: 1, maxQuantity: null, amount: '55' }], variants: {} });
    await expectInSync('after a base-price write');
    await f.setBase(f.products.P4, { product: [], variants: {} });
    await expectInSync('after a base price is cleared');

    const source = await f.book({ name: 'G15 source', audience: 'everyone', rows: [{ product: f.products.P3, fixed: '29' }] });
    const copy = await api.post<{ data: { id: string } }>(`/api/v1/admin/price-books/${source.id}/duplicate`, {
      name: 'G15 copy',
      channelIds: [f.channels.CH1.id],
      currencyCode: 'PLN',
      audience: { kind: 'everyone', memberIds: [] },
    });
    expect(copy.status, copy.raw).toBe(201);
    expect(await linesOf(copy.body.data.id)).toEqual([f.products.P3.id]);
    await expectInSync('after a duplicate');

    expect((await api.delete(`/api/v1/admin/price-books/${copy.body.data.id}`)).status).toBe(204);
    expect(await linesOf(copy.body.data.id)).toEqual([]);
    await expectInSync('after a book delete');
  });

  it('a product hard delete cascades', async () => {
    const book = await f.book({ name: 'G15 doomed', audience: 'everyone', activate: false, rows: [{ product: f.products.P2, fixed: '1' }] });
    await sql(`delete from "products" where "id" = ?`, [f.products.P2.id]);
    expect(await linesOf(book.id)).toEqual([]);
    await expectInSync('after a product hard delete');
  });

  it('a variant delete that leaves a product line without rows is reconciled from the catalogue event', async () => {
    const book = await f.book({ name: 'G15 variant only', audience: 'everyone', activate: false, rows: [{ product: f.products.P5, variant: f.variants.P5b, fixed: '70' }] });
    expect(await linesOf(book.id)).toEqual([f.products.P5.id]);
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${f.products.P5.id}/variants/${f.variants.P5b}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
    for (let i = 0; i < 50 && (await linesOf(book.id)).length > 0; i += 1) await new Promise((r) => setTimeout(r, 100));
    expect(await linesOf(book.id)).toEqual([]);
    await expectInSync('after the variant delete');
  });

  it('the migration backfills it from the matrix rows', async () => {
    const migration = (direction: 'up' | 'down') => async () => {
      const m = new Migration20261022T182527PriceListsProductLines(h.em().getDriver(), h.em().config);
      await m[direction]();
      for (const query of m.getQueries()) await h.em().execute(query as string);
    };
    await migration('down')();
    expect((await sql<{ t: string | null }>(`select to_regclass('price_list_product_lines')::text as t`))[0]!.t).toBeNull();
    await migration('up')();
    await expectInSync('after the backfill');
    expect((await sql<{ n: number }>(`select count(*)::int as n from "price_list_product_lines"`))[0]!.n).toBeGreaterThan(0);
  });
});
