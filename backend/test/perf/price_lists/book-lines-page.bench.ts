// perf-weight: heavy — a 50 000-product catalogue and a 50 000-line base book; tens of seconds of fixture.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBookLinesResponse } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { BASE_BOOK_ID, ensureBaseBookSql } from '../../helpers/price-book-sql.js';
import {
  seedBulkProductsSql,
  seedBulkVariantsSql,
  seedEmptyBookSql,
  seedProductTiersSql,
  seedVariantRowsSql,
} from '../../helpers/price-book-bulk.js';

/**
 * Feature 161, G15 (`specs/161-price-book-editor/contracts/backend-gaps.md`,
 * redesign `research.md` R14; supersedes T011) — every page of the grid's lines
 * read answers within **150 ms p95** (the platform's listing-page budget, SC-005
 * of spec 160) on the whole admin HTTP path, at 50 000 lines.
 *
 * Fixture (`PERF_BOOK_LINES`, default 50 000): products `<word> Bench 00001` …
 * (seven words in turn: `Screw`, `Bolt`, `Nut`, `Washer`, `Anchor`, `Rivet`,
 * `Pin`), SKU `SKU-00001` …; each in the PLN base book with 1–4 tiers, a variant
 * row on every fiftieth (so the base book holds about 50 003 lines with the
 * seeded catalogue's), and the first 300 in a regular book.
 *
 * Cases, on both books, each over `PERF_ITERATIONS` (default 50) requests after
 * five warm-ups, each asserted ≤ 150 ms p95:
 *   - first, middle and last page (100 lines);
 *   - searches, first and last page each: selective `sku-0123` (10 matches),
 *     broad `screw` (a name word, one product in seven), all-matching `sku` (a
 *     SKU prefix every product shares), two-character `cr` and no-match `zz`.
 *
 * PERF_RUN=true to run.
 *
 * **Measured 2026-10-22 — one case over budget, reported; the budget stands.**
 * One developer machine (16 threads), the test Postgres (port 5441), 50 003 /
 * 300 lines, 50 iterations, load average about 1. p95 in ms, run 1 | run 2:
 *
 * | Case | 50 003-line base book | 300-line book |
 * | --- | --- | --- |
 * | first / middle / last page | 88.6 / 110.3 / 96.2 \| 76.5 / 109.8 / 83.6 | 24.9 / 30.1 / 57.0 \| 26.3 / 52.0 / 57.3 |
 * | selective `sku-0123`, first / last | 82.3 / 84.1 \| 78.2 / 87.2 | 23.5 / 33.2 \| 23.5 / 24.6 |
 * | broad `screw`, first / last | 120.4 / 97.0 \| 123.1 / 85.2 | 83.2 / 83.8 \| 50.3 / 73.8 |
 * | all-matching `sku`, first / last | 101.0 / **142.5** \| 94.7 / **157.7** | 73.7 / 76.2 \| 72.8 / 73.9 |
 * | two-character `cr`, first / last | 105.5 / 85.9 \| 106.2 / 85.7 | 52.1 / 57.6 \| 50.7 / 54.0 |
 * | no match `zz`, first / last | 74.9 / 46.2 \| 46.9 / 47.4 | 23.3 / 23.5 \| 35.6 / 24.8 |
 *
 * The over-budget case, statement by statement (30 requests, p50 / p95): the
 * search count 35.7 / 57.9 ms; the dense page 75.0 / 87.5 ms; everything else
 * under 10 ms together. `EXPLAIN ANALYZE` of the dense page: the planner does
 * **not** walk `products_admin_order_en` — it seq-scans `products`, keeps all
 * 50 000 rows and sorts them (`external merge, Disk: 2632kB`), 88 ms; the count
 * is a seq scan with the hashed membership, 42 ms.
 */

const lineCount = Number(process.env['PERF_BOOK_LINES'] ?? '50000');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '50');
const budget = Number(process.env['PERF_BOOK_LINES_P95_MS'] ?? '150');
const shouldRun = process.env['PERF_RUN'] === 'true';
const PAGE_SIZE = 100;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
}

describe.skipIf(!shouldRun)('price-book lines — every page within 150 ms p95 at 50 000 lines (161 G15)', () => {
  let h: BackendServerHandle;
  let small: string;
  const results: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await ensureBaseBookSql(em, 'PLN');
    const products = await seedBulkProductsSql(em, {
      count: lineCount,
      namePrefix: 'Bench',
      skuPrefix: 'SKU',
      words: ['Screw', 'Bolt', 'Nut', 'Washer', 'Anchor', 'Rivet', 'Pin'],
    });
    await seedProductTiersSql(em, BASE_BOOK_ID, products, 4);
    const variants = await seedBulkVariantsSql(em, products.filter((_, i) => i % 50 === 0), 'BENCHV');
    await seedVariantRowsSql(em, BASE_BOOK_ID, variants);
    small = await seedEmptyBookSql(em, 'G15 bench 300 lines');
    await seedProductTiersSql(em, small, products.slice(0, 300), 2);
    for (const table of ['products', 'product_variants', 'price_list_matrix_entries', 'price_list_product_lines']) {
      await em.getConnection().execute(`vacuum analyze "${table}"`);
    }
  }, 15 * 60_000);

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log(`[perf/book-lines-page] lines=${lineCount} iterations=${iterations} budget=${budget}ms\n${results.join('\n')}`);
    await teardownBackendServer(h);
  });

  const get = (bookId: string, query: string) =>
    h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/price-books/${bookId}/lines?lang=en&pageSize=${PAGE_SIZE}&${query}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });

  /** The page count of a query, from its first page. */
  async function pagesOf(bookId: string, search: string | null): Promise<number> {
    const res = await get(bookId, `page=1${search ? `&search=${encodeURIComponent(search)}` : ''}`);
    expect(res.statusCode, res.body).toBe(200);
    return Math.max(1, Math.ceil((res.json() as PriceBookLinesResponse).meta.totalLines / PAGE_SIZE));
  }

  async function scenario(book: string, bookId: string, label: string, search: string | null, pick: (pages: number) => number): Promise<void> {
    const pages = await pagesOf(bookId, search);
    const pageNo = pick(pages);
    const query = `page=${pageNo}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
    for (let i = 0; i < 5; i += 1) await get(bookId, query);
    const samples: number[] = [];
    let body: PriceBookLinesResponse | null = null;
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now();
      const res = await get(bookId, query);
      samples.push(performance.now() - start);
      expect(res.statusCode, res.body).toBe(200);
      body = res.json() as PriceBookLinesResponse;
    }
    // What was measured, before how long it took: the page the query has.
    const total = body!.meta.totalLines;
    expect(body!.data.length).toBe(Math.max(0, Math.min(PAGE_SIZE, total - (pageNo - 1) * PAGE_SIZE)));
    const value = p95(samples);
    results.push(`${book} | ${label} | page ${pageNo}/${pages} | lines ${total} | p95 ${value.toFixed(1)} ms`);
    expect(value, `${book} ${label}`).toBeLessThanOrEqual(budget);
  }

  const first = () => 1;
  const middle = (pages: number) => Math.ceil(pages / 2);
  const last = (pages: number) => pages;
  const SEARCHES: Array<[string, string]> = [
    ['selective', 'sku-0123'],
    ['broad', 'screw'],
    ['all-matching', 'sku'],
    ['two-character', 'cr'],
    ['no match', 'zz'],
  ];

  for (const [book, idOf] of [
    ['50 000-line base book', () => BASE_BOOK_ID],
    ['300-line book', () => small],
  ] as const) {
    it(`${book}: first, middle and last page`, async () => {
      await scenario(book, idOf(), 'first page', null, first);
      await scenario(book, idOf(), 'middle page', null, middle);
      await scenario(book, idOf(), 'last page', null, last);
    }, 10 * 60_000);

    for (const [label, term] of SEARCHES) {
      it(`${book}: search ${label} (${term}), first and last page`, async () => {
        await scenario(book, idOf(), `search ${label} first`, term, first);
        await scenario(book, idOf(), `search ${label} last`, term, last);
      }, 10 * 60_000);
    }
  }
});
