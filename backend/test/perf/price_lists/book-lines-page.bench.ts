// perf-weight: heavy — a 50 000-line base book; tens of seconds of fixture.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBookLinesResponse } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { BASE_BOOK_ID, ensureBaseBookSql } from '../../helpers/price-book-sql.js';
import {
  seedBulkProductsSql,
  seedBulkVariantsSql,
  seedProductTiersSql,
  seedVariantRowsSql,
} from '../../helpers/price-book-bulk.js';

/**
 * Feature 161, G15 (`specs/161-price-book-editor/contracts/backend-gaps.md`) —
 * a 100-line page of a 50 000-line base book answers within **150 ms p95**
 * (the platform's listing-page budget, SC-005 of spec 160), first and last
 * page, with and without a search, through the whole admin request.
 *
 * Fixture (`PERF_BOOK_LINES`, default 50 000): products `Bench 00001` …, each
 * with 1–4 tiers in the PLN base book, a variant row on every fiftieth. The
 * search (`Bench 1`) matches the 10 000 lines `Bench 10000` … `Bench 19999`, so its last
 * page (100) is deep as well.
 *
 * PERF_RUN=true to run. `PERF_ITERATIONS` (default 50) per scenario.
 *
 * **Measured 2026-10-22 — over budget, reported to the owner; the budget stands.**
 * One developer machine (16 threads), the test Postgres (port 5441), the
 * default fixture (50 003 lines, 126 003 rows), 50 iterations, load average
 * about 1: p95 first page 649.1 ms, last page 674.3 ms, search first page
 * 1 319.7 ms, search last page 1 283.6 ms (an earlier run: 641.8 / 701.6 /
 * 1 298.1 / 1 260.6 ms). One first-page request, statement by statement:
 * book header 38 ms (P1's header computes `tier_starts` and `row_count` over
 * the whole book), the book's product ids 59 ms (50 003 ids to the process),
 * `pageProductIdsByName` 428 ms (the 50 003 ids sent back and every product's
 * shown name computed and sorted), page rows 5 ms, labels 2 ms. The cost per
 * page is constant in statements (`price-book-lines-statements.test.ts`) but
 * linear in the book in time: the design's "one scan of ids" handed through
 * the port is itself above 150 ms at this size.
 */

const lineCount = Number(process.env['PERF_BOOK_LINES'] ?? '50000');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '50');
const budget = Number(process.env['PERF_BOOK_LINES_P95_MS'] ?? '150');
const shouldRun = process.env['PERF_RUN'] === 'true';

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
}

describe.skipIf(!shouldRun)('price-book lines — a page of a 50 000-line base book (161 G15)', () => {
  let h: BackendServerHandle;
  const results: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await ensureBaseBookSql(em, 'PLN');
    const products = await seedBulkProductsSql(em, { count: lineCount, namePrefix: 'Bench', skuPrefix: 'G15B' });
    await seedProductTiersSql(em, BASE_BOOK_ID, products, 4);
    const variants = await seedBulkVariantsSql(em, products.filter((_, i) => i % 50 === 0), 'G15BV');
    await seedVariantRowsSql(em, BASE_BOOK_ID, variants);
    await em.getConnection().execute('analyze "products"');
    await em.getConnection().execute('analyze "product_variants"');
    await em.getConnection().execute('analyze "price_list_matrix_entries"');
  }, 10 * 60_000);

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log(`[perf/book-lines-page] lines=${lineCount} iterations=${iterations}\n${results.join('\n')}`);
    await teardownBackendServer(h);
  });

  async function scenario(label: string, query: string): Promise<number> {
    const url = `/api/v1/admin/price-books/${BASE_BOOK_ID}/lines?lang=en&pageSize=100&${query}`;
    const cookies = { b2b_session: 'stub-admin-session' };
    for (let i = 0; i < 5; i += 1) await h.app.inject({ method: 'GET', url, cookies });
    const samples: number[] = [];
    let lines = 0;
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now();
      const res = await h.app.inject({ method: 'GET', url, cookies });
      samples.push(performance.now() - start);
      expect(res.statusCode, res.body).toBe(200);
      lines = (res.json() as PriceBookLinesResponse).data.length;
    }
    // What was measured, before how long it took: a full page of lines.
    expect(lines).toBe(100);
    const value = p95(samples);
    results.push(`${label}: p95=${value.toFixed(1)}ms (budget ${budget}ms)`);
    return value;
  }

  it('first page', async () => {
    expect(await scenario('first page', 'page=1')).toBeLessThanOrEqual(budget);
  }, 5 * 60_000);

  it('last page', async () => {
    expect(await scenario('last page', `page=${Math.ceil(lineCount / 100)}`)).toBeLessThanOrEqual(budget);
  }, 5 * 60_000);

  it('first page of a search', async () => {
    expect(await scenario('search first page', 'page=1&search=Bench%201')).toBeLessThanOrEqual(budget);
  }, 5 * 60_000);

  it('last page of a search', async () => {
    expect(await scenario('search last page', 'page=100&search=Bench%201')).toBeLessThanOrEqual(budget);
  }, 5 * 60_000);
});
