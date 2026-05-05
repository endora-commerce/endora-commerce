import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import { PricingService } from '../../../src/modules/price_lists/services/pricing-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../src/modules/price_lists/services/default-price-list-migration.js';
import { PriceList } from '../../../src/modules/price_lists/entities/price-list.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

/**
 * Resolver perf bench (T102).
 *
 * Spec target — `resolveEngine` p95 < 50 ms with 50 active price lists,
 * ~5 candidate matches per tuple, 5 brackets per (list, product, currency)
 * — measured with the LRU cache **disabled** so the harness times the
 * pure DB + rule-eval cost. Production composition adds the 60-s LRU on
 * top, so warm reads are sub-millisecond.
 *
 * The fixture seeds:
 *   - 50 price lists, each with `kind: 'all'` rules (so all 50 match
 *     every customer); the resolver still has to load + evaluate them
 *     all, walk the priority chain (every list lands at level 5: "any
 *     other matching list"), and pick the winner via tieBreak().
 *   - The seeded SEED_PRODUCT_101 is assigned to every list with 5
 *     PLN brackets per list, so the bracket lookup runs over a non-
 *     trivial corpus.
 *
 * Tuning knobs (env):
 *   PERF_LIST_COUNT    — number of active lists (default 50)
 *   PERF_BRACKETS      — brackets per (list, product, currency) (default 5)
 *   PERF_ITERATIONS    — request count (default 200)
 *   PERF_P95_BUDGET_MS — assertion budget (default 50)
 *   PERF_RUN           — set to 'true' to actually run; otherwise the
 *                         suite skips so PR runs aren't blocked by
 *                         perf flake.
 */

const listCount = Number(process.env['PERF_LIST_COUNT'] ?? '50');
const bracketsPerCurrency = Number(process.env['PERF_BRACKETS'] ?? '5');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '200');
const p95Budget = Number(process.env['PERF_P95_BUDGET_MS'] ?? '50');
const shouldRun = process.env['PERF_RUN'] === 'true';

describe.skipIf(!shouldRun)('pricing resolver — p95 latency', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await em
      .getConnection()
      .execute(
        `truncate table "price_list_price_brackets", "price_list_products", "price_lists" cascade`,
      );
    await new DefaultPriceListMigrator(h.em).seedDefault();

    const svc = new PriceListService(h.em);
    // Seed the Default list with a bracket so the terminal floor exists.
    await svc.addProduct(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID, {
      PLN: makeBrackets(bracketsPerCurrency, 100),
    });

    // Seed N additional active lists, each with brackets on the same
    // product. Every list has rule `{ kind: 'all' }` so they all match
    // the resolver's context and have to be evaluated + tie-broken.
    for (let i = 0; i < listCount; i++) {
      const id = randomUUID();
      const list = em.create(PriceList, {
        id,
        code: `pl-${id.slice(0, 8)}`,
        name: `Perf list ${String(i).padStart(3, '0')}`,
        currency: 'PLN',
        isDefault: false,
        priority: 0,
        type: i % 5 === 0 ? 'sale' : 'base',
        status: 'active',
        startsAt: null,
        endsAt: null,
        applicationRule: { kind: 'all' as const },
        isSystem: false,
        modifiedAt: new Date(Date.now() - i * 60_000),
      });
      await em.persistAndFlush(list);
      await svc.addProduct(list.id, SEED_PRODUCT_101_ID);
      await svc.replaceBrackets(list.id, SEED_PRODUCT_101_ID, {
        PLN: makeBrackets(bracketsPerCurrency, 100 + i),
      });
    }
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('resolveEngine stays under the p95 budget without cache', async () => {
    const em = h.em();
    const product = await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID });
    const channel = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    // Build a fresh PricingService with the cache disabled (test-server
    // already constructs one with ttl=0, but we want a clean slate so
    // the bench measures the cold path on every call).
    const pricing = new PricingService(h.em);

    // Warm-up — first few calls pay the JIT + connection-pool cost.
    for (let i = 0; i < 10; i++) {
      await pricing.resolveEngine({
        product,
        variantId: null,
        context: { quantity: 1, salesChannel: channel, organization: null },
      });
    }

    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const qty = 1 + (i % bracketsPerCurrency);
      const start = performance.now();
      const out = await pricing.resolveEngine({
        product,
        variantId: null,
        context: { quantity: qty, salesChannel: channel, organization: null },
      });
      samples.push(performance.now() - start);
      expect(out.base.bracket).not.toBeNull();
    }

    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0;
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
    const p99 = samples[Math.floor(samples.length * 0.99)] ?? 0;

    // eslint-disable-next-line no-console
    console.log(
      `[perf/resolver] lists=${listCount} brackets=${bracketsPerCurrency} ` +
        `iterations=${iterations} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms ` +
        `p99=${p99.toFixed(2)}ms budget=${p95Budget}ms`,
    );
    expect(p95).toBeLessThan(p95Budget);
  }, 10 * 60_000);
});

function makeBrackets(count: number, baseAmount: number): Array<{
  minQuantity: number;
  maxQuantity: number | null;
  amount: string;
}> {
  const out: Array<{ minQuantity: number; maxQuantity: number | null; amount: string }> = [];
  let cursor = 1;
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const max = isLast ? null : cursor + 9;
    out.push({
      minQuantity: cursor,
      maxQuantity: max,
      amount: `${(baseAmount - i).toFixed(4)}`,
    });
    cursor = (max ?? cursor) + 1;
  }
  return out;
}
