import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBook, PriceBookRow, PriceBookRowsDryRun, PriceBookDiffRow } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import {
  exportCsv,
  parseCsv,
  serverLineErrors,
  type CsvParsed,
} from '../../../../packages/modules/price_lists/src/admin/lib/price-book-csv.js';

/**
 * Feature 161 (T091; US9; FR-038–FR-041, SC-009) — the CSV import against the
 * server, through the editor's own codec
 * (`price_lists/src/admin/lib/price-book-csv.ts`): nothing here hand-writes a
 * batch row.
 *
 * - An exported E3 book re-imported gives an empty preview, in merge and in
 *   replace mode.
 * - A file with one change, one addition and one unknown SKU previews exactly
 *   that, with the unknown SKU on its file line and column, and writes nothing.
 * - **The preview is what the commit does**: the fixed file is previewed, the
 *   same body is committed against the preview's version, and the book read
 *   back equals the stored rows moved by the preview's diff — and equals the
 *   file, line for line, when exported again.
 * - Replace mode lists the rows missing from the file as removed and removes
 *   exactly those.
 * - A commit against a version that moved since the preview is refused and
 *   writes nothing.
 */

describe('the CSV import round trip (161 T091)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  const B = '/api/v1/admin/price-books';

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
  }, 5 * 60_000);

  afterEach(async () => {
    await f.clearBooks();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * E3's Acme contract (worked examples §10): Screws −15 %, Screws 0200 −5 %; plus P2's two tiers and a
   * red adjustment, with fractions, so a decimal lost on the way out or in shows.
   */
  async function e3Acme(): Promise<string> {
    const { id } = await f.book({
      name: 'Acme contract',
      audience: { organizations: [f.orgs.Acme] },
      rows: [
        { category: f.categories.screws, percent: '-15' },
        { product: f.products.P1, percent: '-5' },
        { product: f.products.P2, min: 1, max: 9, fixed: '45.5' },
        { product: f.products.P2, min: 10, fixed: '40.125' },
        { attribute: ['color', 'red'], amount: '2.25' },
      ],
    });
    return id;
  }

  async function rowsOf(id: string): Promise<PriceBookRow[]> {
    const res = await api.get<{ data: PriceBookRow[] }>(`${B}/${id}/rows?page=1&pageSize=1000`);
    expect(res.status, res.raw).toBe(200);
    return res.body.data;
  }

  async function versionOf(id: string): Promise<number> {
    return (await api.get<{ data: PriceBook }>(`${B}/${id}`)).body.data.version;
  }

  function parse(text: string): CsvParsed {
    const result = parseCsv(text);
    if (!result.ok) throw new Error(`file refused: ${JSON.stringify(result.error)}`);
    expect(result.errors).toEqual([]);
    return result;
  }

  async function preview(id: string, file: CsvParsed, mode: 'merge' | 'replace'): Promise<PriceBookRowsDryRun> {
    const res = await api.put<{ data: PriceBookRowsDryRun }>(`${B}/${id}/rows?dryRun=true`, {
      mode,
      upsert: file.rows.map((r) => r.input),
      delete: [],
    });
    expect(res.status, res.raw).toBe(200);
    return res.body.data;
  }

  async function commit(id: string, file: CsvParsed, mode: 'merge' | 'replace', expectedVersion: number) {
    return api.put<{ data: { version: number } }>(`${B}/${id}/rows`, {
      mode,
      upsert: file.rows.map((r) => r.input),
      delete: [],
      expectedVersion,
    });
  }

  /** A row as content: what it selects, its window and its price — no id. */
  const content = (row: Pick<PriceBookDiffRow, 'naturalKey' | 'minQuantity' | 'maxQuantity' | 'price'>): string =>
    JSON.stringify([row.naturalKey, row.minQuantity, row.maxQuantity, row.price]);
  const contents = (rows: ReadonlyArray<Parameters<typeof content>[0]>): string[] => rows.map(content).sort();

  /** The data lines of an export, order-insensitive. */
  const dataLines = (text: string): string[] =>
    text
      .replace(/^﻿/, '')
      .split('\r\n')
      .slice(1)
      .filter((l) => l !== '')
      .sort();

  it('an exported E3 book re-imported previews no change, in merge and in replace mode', async () => {
    const id = await e3Acme();
    const stored = await rowsOf(id);
    for (const language of ['en', 'pl'] as const) {
      const file = parse(exportCsv(stored, language));
      for (const mode of ['merge', 'replace'] as const) {
        const answer = await preview(id, file, mode);
        expect(answer.errors, `${language} ${mode}`).toEqual([]);
        expect(answer.diff, `${language} ${mode}`).toEqual({ added: [], changed: [], removed: [], unchangedCount: stored.length });
      }
    }
  });

  it('a change, an addition and an unknown SKU preview as such, on their file lines, and write nothing', async () => {
    const id = await e3Acme();
    const stored = await rowsOf(id);
    const version = await versionOf(id);
    const exported = exportCsv(stored, 'pl');
    const p1Line = `produkt;${f.products.P1.sku};;;;;1;;procent;-5,00`;
    expect(exported).toContain(p1Line);
    const edited =
      exported.replace(p1Line, `produkt;${f.products.P1.sku};;;;;1;;procent;-7,00`) +
      `produkt;${f.products.P3.sku};;;;;1;;stala;25,00\r\n` +
      'produkt;NO-SUCH-SKU;;;;;1;;stala;10,00\r\n';
    const file = parse(edited);
    const answer = await preview(id, file, 'merge');

    expect(answer.diff.changed.map((c) => [c.before.price, c.after.price])).toEqual([
      [{ type: 'percent', percent: '-5.00' }, { type: 'percent', percent: '-7.00' }],
    ]);
    expect(answer.diff.added.map((r) => [r.selection.productId, r.price])).toEqual([[f.products.P3.id, { type: 'fixed', amount: '25.0000' }]]);
    expect(answer.diff.removed).toEqual([]);
    const unknownLine = file.rows.find((r) => r.input.key?.productSku === 'NO-SUCH-SKU')!.line;
    expect(serverLineErrors(answer.errors, file.rows, answer.resolved)).toEqual([
      { line: unknownLine, column: 'product_sku', code: 'unknownProduct', params: { value: 'NO-SUCH-SKU' } },
    ]);

    // Nothing was written: the rows and the version are as they were.
    expect(contents(await rowsOf(id))).toEqual(contents(stored));
    expect(await versionOf(id)).toBe(version);
  });

  it('commits the previewed file exactly as previewed, and the book then equals the file', async () => {
    const id = await e3Acme();
    const stored = await rowsOf(id);
    const p1Line = `product;${f.products.P1.sku};;;;;1;;percent;-5.00`;
    const fixed = exportCsv(stored, 'en').replace(p1Line, `product;${f.products.P1.sku};;;;;1;;percent;-7.00`) + `product;${f.products.P3.sku};;;;;1;;fixed;25.00\r\n`;
    const file = parse(fixed);

    const answer = await preview(id, file, 'merge');
    expect(answer.errors).toEqual([]);
    expect(answer.diff.changed).toHaveLength(1);
    expect(answer.diff.added).toHaveLength(1);

    const written = await commit(id, file, 'merge', answer.version);
    expect(written.status, written.raw).toBe(200);
    expect(written.body.data.version).toBeGreaterThan(answer.version);

    // The stored rows moved by the preview's diff …
    const changedBefore = new Set(answer.diff.changed.map((c) => content(c.before)));
    const expected = [
      ...stored.filter((r) => !changedBefore.has(content(r))).map(content),
      ...answer.diff.changed.map((c) => content(c.after)),
      ...answer.diff.added.map(content),
    ].sort();
    const after = await rowsOf(id);
    expect(contents(after)).toEqual(expected);
    // … the changed row kept its id (a change, not a delete and an insert) …
    const changedId = answer.diff.changed[0]!.before.id;
    expect(after.some((r) => r.id === changedId)).toBe(true);
    // … and the book exported again is the file, line for line.
    expect(dataLines(exportCsv(after, 'en'))).toEqual(dataLines(fixed));
    // A second preview of the same file is empty.
    expect((await preview(id, file, 'merge')).diff).toMatchObject({ added: [], changed: [], removed: [] });
  });

  it('replace mode lists the rows missing from the file as removed, and removes exactly those', async () => {
    const id = await e3Acme();
    const stored = await rowsOf(id);
    const kept = stored.filter((r) => r.selectionKind !== 'category');
    const file = parse(exportCsv(kept, 'en'));

    const merged = await preview(id, file, 'merge');
    expect(merged.diff.removed).toEqual([]);
    const answer = await preview(id, file, 'replace');
    expect(answer.errors).toEqual([]);
    expect(answer.diff.removed.map((r) => r.selectionKind)).toEqual(['category']);
    expect(answer.diff.added).toEqual([]);
    expect(answer.diff.changed).toEqual([]);

    const written = await commit(id, file, 'replace', answer.version);
    expect(written.status, written.raw).toBe(200);
    expect(contents(await rowsOf(id))).toEqual(contents(kept));
  });

  it('refuses a commit against a version that moved since the preview, and writes nothing', async () => {
    const id = await e3Acme();
    const stored = await rowsOf(id);
    const file = parse(exportCsv(stored, 'en') + `product;${f.products.P3.sku};;;;;1;;fixed;25.00\r\n`);
    const answer = await preview(id, file, 'merge');

    // Someone else saves the book meanwhile.
    const other = parse(exportCsv(stored, 'en').replace('percent;-5.00', 'percent;-6.00'));
    const elsewhere = await commit(id, other, 'merge', answer.version);
    expect(elsewhere.status, elsewhere.raw).toBe(200);
    const between = await rowsOf(id);

    const stale = await commit(id, file, 'merge', answer.version);
    expect(stale.status, stale.raw).toBe(409);
    expect(stale.raw).toContain('PRICE_BOOK_STALE');
    expect(contents(await rowsOf(id))).toEqual(contents(between));
  });
});
