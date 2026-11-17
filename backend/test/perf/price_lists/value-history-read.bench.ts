// perf-weight: fast — one book with 100 000 history lines over 200 changes, seeded by SQL; seconds locally.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBookHistoryChangesResponse } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { seedEmptyBookSql } from '../../helpers/price-book-bulk.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * Issue #470 stage 3 (architect rulings 2026-11-17, D-5) — the price-change
 * history's three reads answer a 50-item page within **150 ms p95** on the
 * whole admin HTTP path, on a book holding about 100 000 history lines over
 * about 200 changes:
 *
 * - `GET …/:id/price-history` — the first page, and a page 100 changes deep;
 * - `GET …/:id/price-history/:changeId/lines` — a 500-line change, first page
 *   and the page from seq 400;
 * - `GET …/:id/price-history/products/:productId` — a product on one line in
 *   ten (10 000 lines), the first page and a page 1 000 lines deep.
 *
 * The changes come in pairs sharing an `at`, so the keyset ties are on the
 * path; half the actors are an administrator, so the page's one actor lookup
 * is too. Seeded by SQL (the reads are what is measured), then
 * `VACUUM ANALYZE` — the state autovacuum leaves the two tables in.
 *
 * Environment: `PERF_RUN=true` to run; `PERF_ITERATIONS` (default 50),
 * `PERF_HISTORY_READ_P95_MS` (default 150).
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '50');
const budget = Number(process.env['PERF_HISTORY_READ_P95_MS'] ?? '150');
const CHANGES = 200;
const LINES_PER_CHANGE = 500;
const LIMIT = 50;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
}

describe.skipIf(!shouldRun)('price-change history reads — a 50-item page within 150 ms p95 at 100 000 lines (#470, stage 3)', () => {
  let h: BackendServerHandle;
  let bookId: string;
  let changeId: string;
  const hot = randomUUID();
  const results: string[] = [];
  const B = '/api/v1/admin/price-books';

  const get = (url: string) => h.app.inject({ method: 'GET', url, cookies: { b2b_session: 'stub-admin-session' } });

  beforeAll(async () => {
    h = await setupBackendServer();
    const conn = h.em().getConnection();
    bookId = await seedEmptyBookSql(h.em(), `S470 history bench ${randomUUID().slice(0, 6)}`);
    await conn.execute(
      `insert into "price_list_value_changes"
         ("id", "price_list_id", "action", "actor_kind", "actor_admin_user_id", "at", "header_before", "header_after", "line_count")
       select gen_random_uuid(), ?, 'price_list.rows_replace',
              case when g % 2 = 0 then 'admin' else 'system' end,
              case when g % 2 = 0 then ?::uuid else null end,
              timestamptz '2026-01-01T00:00:00Z' + (g / 2) * interval '1 hour',
              null, null, ?
         from generate_series(1, ?) g`,
      [bookId, TEST_ADMIN_ID, LINES_PER_CHANGE, CHANGES],
    );
    // One line in ten names the hot product, the rest a product each (the
    // store references no catalogue row, so the ids need not exist).
    await conn.execute(
      `insert into "price_list_row_value_changes"
         ("change_id", "seq", "price_list_id", "at", "kind", "product_id", "min_quantity", "after_price_type", "after_amount")
       select c."id", s.seq, c."price_list_id", c."at", 'added',
              case when s.seq % 10 = 0 then ?::uuid else md5(c."id"::text || s.seq::text)::uuid end,
              1 + s.seq, 'fixed', (s.seq * 0.0001)::numeric(14,4)
         from "price_list_value_changes" c cross join generate_series(0, ? - 1) s(seq)
        where c."price_list_id" = ?`,
      [hot, LINES_PER_CHANGE, bookId],
    );
    for (const table of ['price_list_value_changes', 'price_list_row_value_changes']) await conn.execute(`vacuum analyze "${table}"`);
    const first = (await get(`${B}/${bookId}/price-history?limit=1`)).json() as PriceBookHistoryChangesResponse;
    changeId = first.data[0]!.id;
  }, 10 * 60_000);

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log(
      `[perf/value-history-read] ${CHANGES} changes × ${LINES_PER_CHANGE} lines, iterations=${iterations}, budget=${budget} ms\n${results.join('\n')}`,
    );
    if (bookId) await h.em().getConnection().execute(`delete from "price_lists" where "id" = ?`, [bookId]);
    await teardownBackendServer(h);
  });

  /** The cursor `pages` pages into `url`, walked through the API, so it is one the route answered. */
  async function cursorAfter(url: string, pages: number): Promise<string> {
    let cursor: string | null = null;
    for (let i = 0; i < pages; i += 1) {
      const res = await get(`${url}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.statusCode, res.body).toBe(200);
      cursor = (res.json() as { pagination: { cursor: string | null } }).pagination.cursor;
      expect(cursor).not.toBeNull();
    }
    return cursor!;
  }

  async function scenario(label: string, url: string, expected: number): Promise<void> {
    for (let i = 0; i < 5; i += 1) await get(url);
    const samples: number[] = [];
    let items = 0;
    for (let i = 0; i < iterations; i += 1) {
      const started = performance.now();
      const res = await get(url);
      samples.push(performance.now() - started);
      expect(res.statusCode, res.body).toBe(200);
      items = (res.json() as { data: unknown[] }).data.length;
    }
    expect(items, label).toBe(expected);
    const value = p95(samples);
    results.push(`${label} | items ${items} | p95 ${value.toFixed(1)} ms`);
    expect(value, label).toBeLessThanOrEqual(budget);
  }

  it('changes: first page and a page 100 changes deep', async () => {
    const url = `${B}/${bookId}/price-history?limit=${LIMIT}`;
    await scenario('changes, first page', url, LIMIT);
    const deep = await cursorAfter(url, 2);
    await scenario('changes, page 3', `${url}&cursor=${encodeURIComponent(deep)}`, LIMIT);
  });

  it('one change’s lines: first page and the page from seq 400', async () => {
    const url = `${B}/${bookId}/price-history/${changeId}/lines?limit=${LIMIT}`;
    await scenario('change lines, first page', url, LIMIT);
    const deep = await cursorAfter(url, 8);
    await scenario('change lines, page 9', `${url}&cursor=${encodeURIComponent(deep)}`, LIMIT);
  });

  it('one product’s lines (10 000 of them): first page and a page 1 000 lines deep', async () => {
    const url = `${B}/${bookId}/price-history/products/${hot}?limit=${LIMIT}`;
    await scenario('product lines, first page', url, LIMIT);
    const deep = await cursorAfter(url, 20);
    await scenario('product lines, page 21', `${url}&cursor=${encodeURIComponent(deep)}`, LIMIT);
  });
});
