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
 * Two states (`PERF_BOOK_LINES_STATE`):
 *   - `steady` (default) — `VACUUM ANALYZE` after the seed: the state autovacuum
 *     leaves a catalogue in once it has run after an import (it analyses a table
 *     after 10 % + 50 rows change, so within minutes of a bulk import).
 *   - `fresh` — no vacuum, autovacuum held off on the four tables: the state
 *     right after a bulk import, before autovacuum's first pass.
 * Both are asserted, so a fresh run that misses the budget fails and says so.
 *
 * PERF_RUN=true to run.
 *
 * **Measured 2026-10-22, after the page-rows read became an index lookup per
 * id** (one developer machine, 16 threads, the test Postgres, load average about
 * 1; p95 ms). Steady, one run: every case ≤ 150 ms, the largest 125.3
 * (all-matching search, last page, 50 003 lines); before that change, three
 * runs, largest 119.0. Fresh, two runs: 23 and 24 of the cases that ran within
 * budget; over in three case-runs, all searches on the 50 003-line book — broad
 * first page 151.9, all-matching last page 152.6, two-character first page
 * 150.6. Per statement on fresh data (p50 / p95): the search count 41 / 54–64
 * ms and the dense walk 39–47 / 55–76 ms, both reading all 50 000 products'
 * heap tuples because there is no visibility map yet; the page-rows read 4.4
 * ms (it was 27–40 ms before it became a lookup per id). Both end with
 * autovacuum's first pass after the import; until then the broadest searches
 * of a 50 000-line book answer in about 150 ms instead of about 125 ms.
 *
 * Before the Checkpoint 2b fix the planner sorted every member instead of
 * walking the index: all-matching search, last page 142.5 / 157.7 ms; middle
 * page 110 ms.
 */

const lineCount = Number(process.env['PERF_BOOK_LINES'] ?? '50000');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '50');
const budget = Number(process.env['PERF_BOOK_LINES_P95_MS'] ?? '150');
const shouldRun = process.env['PERF_RUN'] === 'true';
/** `steady` (default): `VACUUM ANALYZE` after the seed. `fresh`: no vacuum, autovacuum held off. */
const state = process.env['PERF_BOOK_LINES_STATE'] === 'fresh' ? 'fresh' : 'steady';
const steady = state === 'steady';
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
      // Steady: what autovacuum leaves a catalogue in once it has run after an
      // import. Fresh: the state right after the import, held there.
      await em.getConnection().execute(steady ? `vacuum analyze "${table}"` : `alter table "${table}" set (autovacuum_enabled = false)`);
    }
  }, 15 * 60_000);

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log(`[perf/book-lines-page] state=${state} lines=${lineCount} iterations=${iterations} budget=${budget}ms\n${results.join('\n')}`);
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
