import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBookLine, PriceBookLinesResponse } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import { BASE_BOOK_ID } from '../../helpers/price-book-sql.js';
import {
  seedBulkProductsSql,
  seedBulkVariantsSql,
  seedEmptyBookSql,
  seedProductTiersSql,
  seedVariantRowsSql,
} from '../../helpers/price-book-bulk.js';

/**
 * Feature 161, G15 (`specs/161-price-book-editor/contracts/backend-gaps.md`) —
 * `GET /api/v1/admin/price-books/:id/lines` pages a book by **line**, not by
 * row: a line is one selection with every row it holds, and a product line
 * carries its variant lines. So a page boundary never splits a line, the
 * variants sit on their product's page, `totalLines` counts lines, and the
 * pages concatenate to every line exactly once, general to specific and by
 * label within a kind (FR-006, FR-013, FR-015).
 *
 * The base book holds 1 200 extra products with 1–4 tiers each and a variant
 * on 100 of them, beside the fixture's own base prices; a small regular book
 * holds one line of every kind for the ordering and the filters; a sparse
 * regular book holds 300 of the bulk products, and a dense one 2 300 more, so a
 * search exercises both of the catalogue's strategies (trigram hits at most
 * 2 000 matches, the ordered walk above). `totalLines` is the book's
 * `price_list_product_lines` count (G15 redesign, `research.md` R14).
 */
describe('price-book lines (161 G15)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let bulk: string[];
  let variantOf: Map<string, string>;
  let mixed: { id: string; rowIds: string[] };
  let sparse: string;
  let dense: string;
  let denseProducts: string[];

  type Stored = { id: string; product_id: string | null; variant_id: string | null };

  const page = (bookId: string, query: string) =>
    api.get<PriceBookLinesResponse>(`/api/v1/admin/price-books/${bookId}/lines?lang=en&${query}`);

  const allPages = async (bookId: string, query = ''): Promise<{ lines: PriceBookLine[]; total: number; pages: number }> => {
    const first = await page(bookId, `page=1&pageSize=100&${query}`);
    expect(first.status, first.raw).toBe(200);
    const total = first.body.meta.totalLines;
    const pages = Math.ceil(total / 100);
    const lines = [...first.body.data];
    for (let n = 2; n <= pages; n += 1) {
      const next = await page(bookId, `page=${n}&pageSize=100&${query}`);
      expect(next.status, next.raw).toBe(200);
      expect(next.body.data.length).toBe(n < pages ? 100 : total - 100 * (pages - 1));
      lines.push(...next.body.data);
    }
    return { lines, total, pages };
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    const em = h.em();
    bulk = await seedBulkProductsSql(em, { count: 1200, namePrefix: 'Lines', skuPrefix: 'G15L' });
    await seedProductTiersSql(em, BASE_BOOK_ID, bulk, 4);
    variantOf = await seedBulkVariantsSql(em, bulk.filter((_, i) => i % 12 === 5), 'G15LV');
    await seedVariantRowsSql(em, BASE_BOOK_ID, variantOf);
    sparse = await seedEmptyBookSql(em, 'G15 sparse 300');
    await seedProductTiersSql(em, sparse, bulk.slice(0, 300), 2);
    denseProducts = await seedBulkProductsSql(em, { count: 2300, namePrefix: 'Dense', skuPrefix: 'G15D' });
    dense = await seedEmptyBookSql(em, 'G15 dense 2 300');
    await seedProductTiersSql(em, dense, denseProducts, 1);
    mixed = await f.book({
      name: 'G15 every kind',
      audience: 'everyone',
      activate: false,
      rows: [
        { product: f.products.P5, variant: f.variants.P5r, percent: '-1' },
        { product: f.products.P2, fixed: '40' },
        { product: f.products.P1, fixed: '90', min: 1, max: 9 },
        { product: f.products.P1, fixed: '85', min: 10 },
        { category: f.categories.screws, attribute: ['color', 'red'], percent: '-3' },
        { category: f.categories.bolts, percent: '-4' },
        { attribute: ['color', 'blue'], percent: '-5' },
        { percent: '-6' },
      ],
    });
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('pages the base book by whole lines: none split, variants on their product’s page, every line once', async () => {
    const stored = (await h.em().getConnection().execute(
      `select "id", "product_id", "variant_id" from "price_list_matrix_entries" where "price_list_id" = ?`,
      [BASE_BOOK_ID],
    )) as Stored[];
    const productIds = [...new Set(stored.map((r) => r.product_id!))];
    const { lines, total } = await allPages(BASE_BOOK_ID);
    expect(total).toBe(productIds.length);
    const lineRows = (await h.em().getConnection().execute(
      `select count(*)::int as n from "price_list_product_lines" where "price_list_id" = ?`,
      [BASE_BOOK_ID],
    )) as Array<{ n: number }>;
    expect(total).toBe(lineRows[0]!.n);
    expect(lines.length).toBe(total);
    expect(new Set(lines.map((l) => l.selectionKey)).size).toBe(total);
    expect(new Set(lines.map((l) => l.selection.productId))).toEqual(new Set(productIds));
    for (const line of lines) {
      expect(line.selectionKind).toBe('product');
      const productId = line.selection.productId!;
      const own = stored.filter((r) => r.product_id === productId && r.variant_id === null).map((r) => r.id).sort();
      expect(line.rows.map((r) => r.id).sort()).toEqual(own);
      const variantIds = [...new Set(stored.filter((r) => r.product_id === productId && r.variant_id !== null).map((r) => r.variant_id!))].sort();
      expect((line.variants ?? []).map((v) => v.selection.variantId).sort()).toEqual(variantIds);
      for (const variant of line.variants ?? []) {
        expect(variant.selectionKind).toBe('variant');
        expect(variant.selection.productId).toBe(productId);
        const rows = stored.filter((r) => r.variant_id === variant.selection.variantId).map((r) => r.id).sort();
        expect(variant.rows.map((r) => r.id).sort()).toEqual(rows);
      }
    }
    // The 1 200 bulk products in name order (`Lines 0001` … sort the same under any collation).
    const order = lines.map((l) => l.selection.productId!).filter((id) => bulk.includes(id));
    expect(order).toEqual(bulk);
    // A product line carries its labels and natural key; a 1–4-tier product kept every tier.
    const sample = lines.find((l) => l.selection.productId === bulk[2])!;
    expect(sample.labels.productName).toBe('Lines 0003');
    expect(sample.naturalKey).toEqual({ productSku: 'G15L-0003' });
    expect(sample.rows.map((r) => r.minQuantity)).toEqual([1, 10, 50, 100]);
  });

  it('orders a book general to specific — all, attribute, category, category ∩ attribute, products — and nests variants', async () => {
    const res = await page(mixed.id, 'page=1&pageSize=50');
    expect(res.status, res.raw).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 50, totalLines: 7 });
    expect(res.body.data.map((l) => l.selectionKind)).toEqual(['all', 'attribute', 'category', 'category_attribute', 'product', 'product', 'product']);
    const products = res.body.data.filter((l) => l.selectionKind === 'product');
    expect(products.map((l) => l.labels.productName)).toEqual(['Screws 0200', 'Screws 0300', 'Screws 0500']);
    const p1 = products[0]!;
    expect(p1.rows.map((r) => [r.minQuantity, r.maxQuantity])).toEqual([
      [1, 9],
      [10, null],
    ]);
    const p5 = products[2]!;
    expect(p5.rows).toEqual([]);
    expect(p5.variants!.map((v) => v.selection.variantId)).toEqual([f.variants.P5r]);
    expect(res.body.data[2]!.labels.categoryPath).toBe('Bolts');
    expect(res.body.data[1]!.labels.attributeValueLabel).toEqual(expect.any(String));
  });

  it('filters by kind — a variant filter answers the product lines that carry a variant line — and searches labels and SKUs', async () => {
    const kinds = await page(mixed.id, 'page=1&pageSize=50&kind=category&kind=all');
    expect(kinds.status, kinds.raw).toBe(200);
    expect(kinds.body.data.map((l) => l.selectionKind)).toEqual(['all', 'category']);
    expect(kinds.body.meta.totalLines).toBe(2);

    const variants = await page(mixed.id, 'page=1&pageSize=50&kind=variant');
    expect(variants.body.data.map((l) => l.selection.productId)).toEqual([f.products.P5.id]);

    const byName = await page(mixed.id, `page=1&pageSize=50&search=${encodeURIComponent('Screws 03')}`);
    expect(byName.body.data.map((l) => l.selection.productId)).toEqual([f.products.P2.id]);
    const byCategory = await page(mixed.id, 'page=1&pageSize=50&search=bolts');
    expect(byCategory.body.data.map((l) => l.selectionKind)).toEqual(['category']);
    const bySku = await page(BASE_BOOK_ID, 'page=1&pageSize=50&search=G15L-0012');
    expect(bySku.body.data.map((l) => l.selection.productId)).toEqual([bulk[11]]);
    expect(bySku.body.meta.totalLines).toBe(1);

    // A search over the base book pages as the whole book does.
    const { lines, total } = await allPages(BASE_BOOK_ID, 'search=Lines%200');
    expect(total).toBe(999);
    expect(lines.map((l) => l.selection.productId)).toEqual(bulk.slice(0, 999));
  });

  it('pages a sparse 300-line book and searches it', async () => {
    const { lines, total } = await allPages(sparse);
    expect(total).toBe(300);
    expect(lines.map((l) => l.selection.productId)).toEqual(bulk.slice(0, 300));
    expect(lines.every((l) => l.rows.length === 2 || l.rows.length === 1)).toBe(true);
    const searched = await allPages(sparse, 'search=Lines%2001');
    expect(searched.total).toBe(100);
    expect(searched.lines.map((l) => l.selection.productId)).toEqual(bulk.slice(99, 199));
  });

  it('a search answers the same lines on the sparse path (≤ 2 000 matches) and the dense path (more)', async () => {
    // Dense: 2 300 matches of `dense`, paged by the ordered walk.
    const broad = await allPages(dense, 'search=dense');
    expect(broad.total).toBe(2300);
    expect(broad.lines.map((l) => l.selection.productId)).toEqual(denseProducts);
    // Sparse: 1 000 of them (`Dense 1…` and `Dense 2…` minus the tail), from the trigram hits.
    const narrow = await allPages(dense, 'search=dense%201');
    expect(narrow.total).toBe(1000);
    expect(narrow.lines.map((l) => l.selection.productId)).toEqual(denseProducts.slice(999, 1999));
    // A variant's SKU finds its product on the base book.
    const variantSku = await page(BASE_BOOK_ID, 'page=1&pageSize=50&search=G15LV-1');
    expect(variantSku.status, variantSku.raw).toBe(200);
    expect(variantSku.body.data.length).toBeGreaterThan(0);
    expect(variantSku.body.data.every((l) => (l.variants ?? []).length === 1)).toBe(true);
  });

  it('refuses a page size above 500 and answers an unknown book 404', async () => {
    expect((await page(mixed.id, 'pageSize=501')).status).toBe(400);
    expect((await page('00000000-0000-4000-8000-0000001615dd', 'pageSize=50')).status).toBe(404);
  });
});
