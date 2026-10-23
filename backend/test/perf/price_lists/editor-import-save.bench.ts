// perf-weight: fast — the pricing fixture's five products and one book of up to 5 000 rows; seconds locally.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBookRowsDryRun } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import { parseCsv } from '../../../../packages/modules/price_lists/src/admin/lib/price-book-csv.js';

/**
 * Feature 161 (T107; FR-036, SC-009) — the wall-clock figures of the editor's
 * two large writes that a script can measure, through the editor's own codec:
 *
 * - **SC-009**: a 1 000-row CSV file read by the codec and previewed by the
 *   server (`PUT …/rows?dryRun=true`) — the time from the file's text to the
 *   preview's answer, which the dialog shows. Target: under 10 s.
 * - **FR-036**: committing a 5 000-row batch (`PUT …/rows`), the largest one
 *   save sends — the server's share of a 5 000-row save. The client's share
 *   (applying the paste and building the batch) is
 *   `price_lists/src/admin/lib/book-edit-state.perf.test.ts`.
 *
 * The rows are the fixture's five products with 1 000 non-overlapping
 * windows each. What a script cannot measure — the operator's walkthrough
 * (SC-001), the paste-and-save by hand (SC-002) and keystroke-to-paint in a
 * browser (SC-004) — is listed in `plan.md` *Measurements* for a person.
 *
 * Environment: `PERF_RUN=true` to run.
 */

const shouldRun = process.env['PERF_RUN'] === 'true';

describe.skipIf(!shouldRun)('the price-book editor’s large writes (161 T107)', () => {
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
    console.log(`[perf] 161 editor writes:\n  ${results.join('\n  ')}`);
    await f.clearBooks();
    await teardownBackendServer(h);
  });

  const header = 'kind;product_sku;variant_sku;category_path;attribute_key;attribute_value;min_quantity;max_quantity;price_kind;value';
  function csv(rows: number): string {
    const products = [f.products.P1, f.products.P2, f.products.P3, f.products.P4, f.products.P5];
    const perProduct = Math.ceil(rows / products.length);
    const lines: string[] = [];
    for (const product of products) {
      for (let i = 1; i <= perProduct && lines.length < rows; i += 1) {
        lines.push(`produkt;${product.sku};;;;;${i};${i};stala;${(100 - i / 100).toFixed(2).replace('.', ',')}`);
      }
    }
    return [header, ...lines].join('\r\n');
  }

  async function emptyBook(): Promise<{ id: string; version: number }> {
    const { id } = await f.book({ audience: 'everyone', rows: [], activate: false });
    const res = await api.get<{ data: { version: number } }>(`${B}/${id}`);
    return { id, version: res.body.data.version };
  }

  it('SC-009 — a 1 000-row file is read and previewed in under 10 s', async () => {
    const book = await emptyBook();
    const text = csv(1000);
    const started = performance.now();
    const parsed = parseCsv(text);
    if (!parsed.ok) throw new Error('refused');
    const res = await api.put<{ data: PriceBookRowsDryRun }>(`${B}/${book.id}/rows?dryRun=true`, {
      mode: 'merge',
      upsert: parsed.rows.map((r) => r.input),
      delete: [],
    });
    const elapsed = performance.now() - started;
    expect(res.status, res.raw).toBe(200);
    expect(res.body.data.errors).toEqual([]);
    expect(res.body.data.diff.added).toHaveLength(1000);
    results.push(`SC-009 1 000-row read + preview: ${elapsed.toFixed(0)} ms (target < 10 000)`);
    expect(elapsed).toBeLessThan(10_000);
  });

  it('FR-036 — a 5 000-row batch commits, and its preview, timed', async () => {
    const book = await emptyBook();
    const parsed = parseCsv(csv(5000));
    if (!parsed.ok) throw new Error('refused');
    const body = { mode: 'merge', upsert: parsed.rows.map((r) => r.input), delete: [] };
    let started = performance.now();
    const preview = await api.put<{ data: PriceBookRowsDryRun }>(`${B}/${book.id}/rows?dryRun=true`, body);
    const previewMs = performance.now() - started;
    expect(preview.status, preview.raw).toBe(200);
    started = performance.now();
    const written = await api.put(`${B}/${book.id}/rows`, { ...body, expectedVersion: book.version });
    const commitMs = performance.now() - started;
    expect(written.status, written.raw).toBe(200);
    results.push(`FR-036 5 000-row preview: ${previewMs.toFixed(0)} ms; commit: ${commitMs.toFixed(0)} ms`);
  });
});
