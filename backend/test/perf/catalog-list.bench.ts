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
 * Tuning knobs (env):
 *   PERF_CORPUS_SIZE   — extra products to seed beyond the test fixtures (default 1000)
 *   PERF_ITERATIONS    — request count (default 200)
 *   PERF_P95_BUDGET_MS — assertion budget (default 250 — slacker than the spec
 *                         target because Postgres path + small corpus)
 *   PERF_RUN           — set to 'true' to actually run; otherwise the suite
 *                         skips so PR runs aren't blocked by perf flake.
 */

const corpusSize = Number(process.env['PERF_CORPUS_SIZE'] ?? '1000');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '200');
const p95Budget = Number(process.env['PERF_P95_BUDGET_MS'] ?? '250');
const shouldRun = process.env['PERF_RUN'] === 'true';

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
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('serves GET /catalog/products under the p95 budget', async () => {
    // Warm-up — first few requests pay the JIT + connection-pool cost.
    for (let i = 0; i < 10; i++) {
      await h.app.inject({ method: 'GET', url: '/api/v1/catalog/products?limit=24' });
    }

    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?limit=24&cursor=${i % 5 === 0 ? '' : ''}`,
      });
      samples.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
    }

    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0;
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
    const p99 = samples[Math.floor(samples.length * 0.99)] ?? 0;

    // eslint-disable-next-line no-console
    console.log(
      `[perf/catalog-list] corpus=${corpusSize} iterations=${iterations} ` +
        `p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms ` +
        `budget=${p95Budget}ms`,
    );

    expect(p95).toBeLessThan(p95Budget);
  }, 10 * 60_000);
});
