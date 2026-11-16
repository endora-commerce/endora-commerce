// perf-weight: fast — the pricing fixture's five products and books of 5 000 rows; seconds locally.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBook } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Issue #470 (D-288; owner ruling O-3), Stage 2 — what the price-change
 * history costs the largest writes a price book takes: since Stage 2, every
 * one of them also writes one `price_list_value_changes` row and a line per
 * row it added, changed or removed, in the same transaction.
 *
 * - a 5 000-row import committed into an empty book: 5 000 added lines;
 * - the same 5 000 rows re-priced (the bulk change): 5 000 changed lines;
 * - a `replace`-mode import of 5 000 other rows: 5 000 removed and 5 000
 *   added lines, the most one batch can write;
 * - a duplicate of the 5 000-row book: 5 000 added lines on the copy.
 *
 * Each case runs `RUNS` times on fresh books and reports the median and the
 * slowest commit. The same file, run with `PERF_BASELINE=true` on a tree
 * without Stage 2, skips the history assertions and gives the baseline the
 * figures are compared with.
 *
 * Environment: `PERF_RUN=true` to run.
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const baseline = process.env['PERF_BASELINE'] === 'true';
const RUNS = 3;
const ROWS = 5000;

describe.skipIf(!shouldRun)('the price-change history’s cost on the largest price-book writes (#470, Stage 2)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  const B = '/api/v1/admin/price-books';
  const results: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
  }, 5 * 60_000);

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log(`[perf] #470 Stage 2 history writes${baseline ? ' (baseline)' : ''}:\n  ${results.join('\n  ')}`);
    await f.clearBooks();
    await teardownBackendServer(h);
  });

  const products = () => [f.products.P1, f.products.P2, f.products.P3, f.products.P4, f.products.P5];
  /** `ROWS` fixed rows in one-unit windows over the five products, sub-cent: `0.0001 × (start + i)` for the i-th window. */
  function rows(offset: number, start: number) {
    const perProduct = ROWS / 5;
    return products().flatMap((product) =>
      Array.from({ length: perProduct }, (_, i) => ({
        selection: { productId: product.id },
        minQuantity: offset + i + 1,
        maxQuantity: offset + i + 1,
        price: { type: 'fixed', amount: `0.${String(start + i).padStart(4, '0')}` },
      })),
    );
  }

  async function emptyBook(): Promise<{ id: string; version: number }> {
    const { id } = await f.book({ audience: 'everyone', rows: [], activate: false });
    const res = await api.get<{ data: { version: number } }>(`${B}/${id}`);
    return { id, version: res.body.data.version };
  }

  async function put(bookId: string, version: number, body: Record<string, unknown>): Promise<{ ms: number; version: number }> {
    const started = performance.now();
    const res = await api.put<{ data: { version: number } }>(`${B}/${bookId}/rows`, { ...body, expectedVersion: version });
    const ms = performance.now() - started;
    expect(res.status, res.raw).toBe(200);
    return { ms, version: res.body.data.version };
  }

  async function lastLineCount(bookId: string): Promise<number> {
    const [row] = await h
      .em()
      .getConnection()
      .execute<Array<{ line_count: number }>>(
        `select "line_count" from "price_list_value_changes" where "price_list_id" = ? order by "at" desc, "id" desc limit 1`,
        [bookId],
      );
    if (!row) throw new Error(`no price-change history row for book ${bookId}`);
    return Number(row.line_count);
  }

  const timings: Record<string, number[]> = { import: [], change: [], replace: [], duplicate: [] };
  const report = (label: string, lines: number) => {
    const ms = [...timings[label]!].sort((a, b) => a - b);
    results.push(
      `${label}: ${lines} lines — median ${ms[Math.floor(ms.length / 2)]!.toFixed(0)} ms, slowest ${ms[ms.length - 1]!.toFixed(0)} ms (runs: ${ms.map((m) => m.toFixed(0)).join(', ')})`,
    );
  };

  it('import, bulk change, replace-mode import and duplicate of 5 000 rows — timed', async () => {
    for (let run = 0; run < RUNS; run += 1) {
      const book = await emptyBook();
      const imported = await put(book.id, book.version, { mode: 'merge', upsert: rows(0, 125), delete: [] });
      timings['import']!.push(imported.ms);
      if (!baseline) expect(await lastLineCount(book.id)).toBe(ROWS);

      const changed = await put(book.id, imported.version, { mode: 'merge', upsert: rows(0, 130), delete: [] });
      timings['change']!.push(changed.ms);
      if (!baseline) expect(await lastLineCount(book.id)).toBe(ROWS);

      const started = performance.now();
      const copy = await api.post<{ data: PriceBook }>(`${B}/${book.id}/duplicate`, {
        name: `Copy ${run}`,
        channelIds: [f.channels.CH1.id],
        currencyCode: 'PLN',
        audience: { kind: 'everyone', memberIds: [] },
        amountMultiplier: '1.1',
      });
      timings['duplicate']!.push(performance.now() - started);
      expect(copy.status, copy.raw).toBe(201);
      if (!baseline) expect(await lastLineCount(copy.body.data.id)).toBe(ROWS);

      const replaced = await put(book.id, changed.version, { mode: 'replace', upsert: rows(ROWS, 200), delete: [] });
      timings['replace']!.push(replaced.ms);
      if (!baseline) expect(await lastLineCount(book.id)).toBe(2 * ROWS);
    }
    report('import', ROWS);
    report('change', ROWS);
    report('replace', 2 * ROWS);
    report('duplicate', ROWS);
  }, 10 * 60_000);
});
