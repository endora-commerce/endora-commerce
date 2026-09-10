// perf-weight: fast — 5912 ms on the CI runner (pipeline 13444, 2026-09-09).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../helpers/package-entities.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Issue #132 — what the listing pays now that it asks `price_lists`.
 *
 * `catalog-list.bench.ts` cannot answer this: its synthetic corpus is not a
 * member of any sales channel, so `filterByChannel` drops every row and the
 * page it times renders no summaries and therefore prices nothing. This bench
 * seeds channel-visible, list-priced products so the number covers the work the
 * change actually added.
 *
 * Skipped unless `PERF_RUN=true`, like every other bench here.
 *
 * ## The budget (issue #143, D-65)
 *
 * D-65 recorded no post-#140 measurement for this bench: it had a budget
 * before it had a number. Measured 2026-08-17 over four runs on a 16-core /
 * 64 GB Linux dev box, load average 1.7-3.6, Postgres 16 on localhost: p95
 * 79.6 / 76.9 / 86.9 / 79.5 ms. Budget = worst observed × 3, rounded up:
 * **275 ms**, down from 400. The multiplier is ×3 rather than D-65's ×2 for
 * the reason stated in `test/perf/catalog-list.bench.ts`. Re-base from the
 * first three scheduled `perf:backend` runs.
 *
 * This is by far the most expensive read in the suite — 6× `catalog-list`,
 * which pages the same table without pricing it — so it is also the one whose
 * budget is worth the least slack.
 */

const pageSize = Number(process.env['PERF_PAGE_SIZE'] ?? '24');
const corpusSize = Number(process.env['PERF_CORPUS_SIZE'] ?? '120');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '40');
const p95Budget = Number(process.env['PERF_LISTING_PRICE_P95_MS'] ?? '275');
const shouldRun = process.env['PERF_RUN'] === 'true';

describe.skipIf(!shouldRun)('priced catalogue listing — p95 latency', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    // `pl_retail` and not the system default: prices are only rendered on a
    // channel flagged public (R-18), so a non-public channel would time a page
    // that resolves nothing.
    const channel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });

    const products = Array.from({ length: corpusSize }, (_, i) => {
      const idx = String(i).padStart(6, '0');
      return em.create(Product, {
        sku: `PRICED-${idx}`,
        slug: `priced-${idx}`,
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Priced product ${idx}` },
        description: { 'en-US': `Synthetic product ${idx}.` },
        visibility: 'public',
        attributeValues: { defaultPrice: 10 + (i % 100) },
      });
    });
    await em.persistAndFlush(products);
    for (const product of products) {
      await h.salesChannels.membershipService.addToChannel(channel.id, 'product', product.id);
    }

    await new DefaultPriceListMigrator(h.em).seedDefault();
    const lists = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));
    for (const product of products) {
      await lists.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
      await lists.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
        PLN: [{ minQuantity: 1, maxQuantity: null, amount: '99.00' }],
      });
    }
  }, 10 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it(`serves a ${pageSize}-item priced page under the p95 budget`, async () => {
    const url = `/api/v1/catalog/products?limit=${pageSize}`;
    const headers = { 'x-sales-channel': 'pl_retail' };
    for (let i = 0; i < 5; i++) await h.app.inject({ method: 'GET', url, headers });

    const samples: number[] = [];
    let priced = 0;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const res = await h.app.inject({ method: 'GET', url, headers });
      samples.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: Array<{ price: unknown }> };
      priced = body.data.filter((p) => p.price !== null).length;
    }

    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0;
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;

    // The bench is worthless if the page it timed priced nothing — which is
    // exactly the trap `catalog-list.bench.ts` fell into.
    expect(priced).toBeGreaterThan(0);

    // eslint-disable-next-line no-console
    console.log(
      `[perf/listing-price] corpus=${corpusSize} page=${pageSize} priced=${priced} ` +
        `iterations=${iterations} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms budget=${p95Budget}ms`,
    );
    expect(p95).toBeLessThan(p95Budget);
  }, 10 * 60_000);
});
