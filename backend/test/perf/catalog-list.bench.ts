import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../helpers/test-server.js';
import { Product } from '../../src/modules/catalog/entities/product.entity.js';

/**
 * Catalog list perf harness (T241 / FR-131).
 *
 * Spec target: p95 < 200 ms at the search-engine layer on a 100k-product
 * index. The Meilisearch indexer + query service are not yet shipped
 * (T067/T068), so this harness exercises the Postgres path in
 * `catalog-query.service.ts` against a smaller corpus and asserts a
 * looser budget. When Meilisearch lands, swap the corpus size + budget
 * to the spec values.
 *
 * ## The corpus must belong to the resolved channel (issue #140)
 *
 * `CatalogQueryService.list` pages the products table, then narrows the page
 * through `filterByChannel`, which fails closed to the empty set (Principle
 * XII). A corpus seeded without a `sales_channel_products` row is therefore
 * paged, dropped, and serialised as an empty page — the request still answers
 * 200, and the harness still reports a p95. That is what this file measured
 * from the day channel scoping landed: the cost of assembling nothing, which
 * no budget stated for a page of summaries can catch.
 *
 * So the fixture binds every seeded product to the channel an anonymous
 * request resolves, and the run asserts that every timed response carried a
 * full page of summaries **before** it asserts how long that took. A future
 * change that silently empties the page fails here instead of reporting a
 * record-breaking latency.
 *
 * ## The budget (issue #143, D-65)
 *
 * Measured 2026-08-17 over four runs on a 16-core / 64 GB Linux dev box,
 * load average 1.7-3.6, Postgres 16 on localhost: p95 13.8 / 15.1 / 14.9 /
 * 14.6 ms. Budget = worst observed × 3, rounded up: **50 ms**, down from the
 * 250 ms it carried, which was 17× the measured value and would have passed a
 * 15× regression in silence.
 *
 * The multiplier is ×3, not D-65's ×2: ×2 is the regression headroom, and the
 * extra ×1.5 covers the gap between this box and the 4 vCPU / 8 GB docker
 * runner the scheduled `perf:backend` job measures on, which no local run can
 * observe. Re-base from the first three scheduled runs — that is the machine
 * that enforces it.
 *
 * Tuning knobs (env):
 *   PERF_CORPUS_SIZE   — extra products to seed beyond the test fixtures (default 1000)
 *   PERF_ITERATIONS    — request count (default 200)
 *   PERF_CATALOG_LIST_P95_MS — assertion budget (default 50, see above)
 *   PERF_RUN           — set to 'true' to actually run; otherwise the suite
 *                         skips so PR runs aren't blocked by perf flake.
 */

const corpusSize = Number(process.env['PERF_CORPUS_SIZE'] ?? '1000');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '200');
const p95Budget = Number(process.env['PERF_CATALOG_LIST_P95_MS'] ?? '50');
const shouldRun = process.env['PERF_RUN'] === 'true';

/** Page size requested on every timed read — also the expected summary count. */
const PAGE_LIMIT = 24;

describe.skipIf(!shouldRun)('catalog list — p95 latency', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const products = Array.from({ length: corpusSize }, (_, i) => {
      const idx = String(i).padStart(6, '0');
      return em.create(Product, {
        sku: `PERF-${idx}`,
        slug: `perf-${idx}`,
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Perf product ${idx}` },
        description: { 'en-US': `Synthetic product ${idx} for perf bench.` },
        visibility: 'public',
        attributeValues: { defaultPrice: 10 + (i % 100) },
      });
    });
    await em.persistAndFlush(products);

    // Channel membership — the storefront read is scoped to the channel an
    // anonymous request resolves, which is the system default. Written as raw
    // SQL in chunks, matching how every other fixture authors this bridge
    // table; a parameter list the size of the corpus would not bind.
    const channelId = (await h.salesChannels.resolver.getSystemDefault()).id;
    const conn = em.getConnection();
    const CHUNK = 500;
    for (let offset = 0; offset < products.length; offset += CHUNK) {
      const slice = products.slice(offset, offset + CHUNK);
      await conn.execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values ` +
          slice.map(() => '(?,?)').join(','),
        slice.flatMap((p) => [channelId, p.id]),
      );
    }
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('serves GET /catalog/products under the p95 budget', async () => {
    const url = `/api/v1/catalog/products?limit=${PAGE_LIMIT}`;

    // Warm-up — first few requests pay the JIT + connection-pool cost.
    for (let i = 0; i < 10; i++) {
      await h.app.inject({ method: 'GET', url });
    }

    const samples: number[] = [];
    let minSummaries = Number.POSITIVE_INFINITY;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const res = await h.app.inject({ method: 'GET', url });
      samples.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: unknown[] };
      minSummaries = Math.min(minSummaries, body.data.length);
    }

    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0;
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
    const p99 = samples[Math.floor(samples.length * 0.99)] ?? 0;

    // eslint-disable-next-line no-console
    console.log(
      `[perf/catalog-list] corpus=${corpusSize} iterations=${iterations} ` +
        `summariesPerPage=${minSummaries} ` +
        `p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms ` +
        `budget=${p95Budget}ms`,
    );

    // What was measured, before how long it took: a full page of summaries on
    // every timed read. An empty page is faster than any budget can catch.
    expect(minSummaries).toBe(PAGE_LIMIT);

    expect(p95).toBeLessThan(p95Budget);
  }, 10 * 60_000);
});
