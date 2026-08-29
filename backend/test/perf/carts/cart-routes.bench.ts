import { CartItem } from '../../helpers/package-entities.js';
import { randomUUID } from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { Product } from '../../helpers/package-entities.js';

import { ProductLink } from '../../helpers/package-entities.js';

import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';


/**
 * Cart routes perf harness (feature 027 T128).
 *
 * Spec targets (`plan.md` § Performance Goals):
 *   - GET /api/v1/cart           p95 < 200 ms on a 50-line cart
 *   - GET /api/v1/cart?view=mini p95 <  80 ms on a 50-line cart
 *   - GET /api/v1/cart/upsells   p95 < 150 ms on a 50-line cart
 *   - coupon application         p95 < 250 ms (covered separately —
 *                                  requires a seeded Promotion)
 *
 * Opt-in: set `PERF_RUN=true` to actually run. By default the suite
 * skips so regular PR runs aren't blocked by perf flake.
 *
 * ## Each scenario asserts what it served (issue #140)
 *
 * The budgets above are all "on a 50-line cart", and the up-sell one is about
 * a populated strip — but each endpoint answers 200 with an empty payload just
 * as readily, and much faster. The up-sell strip in particular is derived from
 * catalog's `product_links`, which no fixture here used to seed: the strip was
 * always empty, so the number reported was the cost of resolving the cart and
 * returning `[]`. So every scenario counts what came back and asserts that
 * count before it asserts the latency.
 *
 * ## The budgets (issue #143, D-65)
 *
 * The three numbers in the spec-target list above are the product promise.
 * The three the assertions use are a *regression detector*, which is a
 * different instrument: it is set from what the code costs today, not from
 * what the buyer was promised, so that a 3× slowdown fails here long before
 * anybody notices it against the promise. D-65 recorded no post-#140
 * measurement for this file, so it had budgets before it had numbers.
 *
 * Measured 2026-08-17 over four runs on a 16-core / 64 GB Linux dev box, load
 * average 1.7-3.6, Postgres 16 on localhost:
 *
 *   full    p95  8.9 / 11.2 /  9.9 /  9.8 ms → × 3 → 35 ms  (was 200)
 *   mini    p95  6.5 /  6.1 /  8.3 /  8.1 ms → × 3 → 25 ms  (was  80)
 *   upsells p95  8.8 /  8.3 / 12.3 / 11.8 ms → × 3 → 40 ms  (was 150)
 *
 * The multiplier is ×3 rather than D-65's ×2 for the reason stated in
 * `test/perf/catalog-list.bench.ts`. Re-base from the first three scheduled
 * `perf:backend` runs.
 *
 * Env knobs:
 *   PERF_CART_LINES           — lines seeded on the test cart (default 50)
 *   PERF_UPSELL_TARGETS       — up-sell link targets seeded (default 12, the
 *                                route's default strip size)
 *   PERF_ITERATIONS           — request count per scenario (default 100)
 *   PERF_FULL_P95_BUDGET_MS   — GET /api/v1/cart budget (default 35)
 *   PERF_MINI_P95_BUDGET_MS   — GET /api/v1/cart?view=mini budget (default 25)
 *   PERF_UPSELL_P95_BUDGET_MS — GET /api/v1/cart/upsells budget (default 40)
 *   PERF_RUN                  — 'true' to enable
 */

const cartLines = Number(process.env['PERF_CART_LINES'] ?? '50');
const upsellTargets = Number(process.env['PERF_UPSELL_TARGETS'] ?? '12');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '100');
const fullBudget = Number(process.env['PERF_FULL_P95_BUDGET_MS'] ?? '35');
const miniBudget = Number(process.env['PERF_MINI_P95_BUDGET_MS'] ?? '25');
const upsellBudget = Number(process.env['PERF_UPSELL_P95_BUDGET_MS'] ?? '40');
const shouldRun = process.env['PERF_RUN'] === 'true';

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

function summary(label: string, samples: number[], budget: number, served: string): void {
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  const p99 = percentile(samples, 0.99);
  // eslint-disable-next-line no-console
  console.log(
    `[perf/${label}] iterations=${samples.length} ${served} ` +
      `p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms ` +
      `budget=${budget}ms`,
  );
}

/** Lines the cart payload carried — the size every budget here is stated for. */
function lineCountOf(body: unknown): number {
  return (body as { data: { items: unknown[] } }).data.items.length;
}

/** The fixture product every seeded cart line points at. */
const SEEDED_PRODUCT_ID = SEED_PRODUCT_101_ID;

describe.skipIf(!shouldRun)('cart routes — storefront perf', () => {
  let h: BackendServerHandle;
  let cartId: string;
  const anonToken = `perf-cart-${Date.now()}`;

  beforeAll(async () => {
    h = await setupBackendServer();

    const seed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEEDED_PRODUCT_ID, quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(seed.statusCode).toBe(200);
    cartId = (seed.json() as { data: { id: string } }).data.id;

    const em = h.em();
    const linesToAdd = Math.max(0, cartLines - 1);
    for (let i = 0; i < linesToAdd; i += 1) {
      em.create(CartItem, {
        cartId,
        productId: SEEDED_PRODUCT_ID,
        variantId: randomUUID(),
        quantity: 1,
        unitPrice: '1.00',
        currency: 'PLN',
      });
    }

    // Up-sell strip fixture: the aggregator walks `product_links` out of the
    // products in the cart, so without link rows the endpoint resolves the
    // cart and returns an empty array. Seed a target product per strip slot.
    // Targets flush first — `product_links.target_product_id` is a foreign key
    // and the ORM does not order the two inserts for us.
    const targets = Array.from({ length: upsellTargets }, (_, i) => {
      const idx = String(i).padStart(4, '0');
      return em.create(Product, {
        sku: `PERF-UPSELL-${idx}`,
        slug: `perf-upsell-${idx}`,
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Perf up-sell target ${idx}` },
        description: { 'en-US': 'Up-sell strip fixture.' },
        visibility: 'public',
        attributeValues: { defaultPrice: 9.99 },
      });
    });
    await em.flush();

    targets.forEach((target, i) =>
      em.create(ProductLink, {
        sourceProductId: SEEDED_PRODUCT_ID,
        targetProductId: target.id,
        kind: 'up_sell',
        position: i,
      }),
    );
    await em.flush();
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('GET /api/v1/cart — full payload p95', async () => {
    // Warm-up.
    for (let i = 0; i < 10; i += 1) {
      await h.app.inject({
        method: 'GET',
        url: '/api/v1/cart',
        cookies: { b2b_cart_anon: anonToken },
      });
    }

    const samples: number[] = [];
    let minLines = Number.POSITIVE_INFINITY;
    for (let i = 0; i < iterations; i += 1) {
      const t0 = performance.now();
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/cart',
        cookies: { b2b_cart_anon: anonToken },
      });
      samples.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
      minLines = Math.min(minLines, lineCountOf(res.json()));
    }

    summary('cart-full', samples, fullBudget, `lines=${minLines}`);
    expect(minLines).toBe(cartLines);
    expect(percentile(samples, 0.95)).toBeLessThan(fullBudget);
  }, 10 * 60_000);

  it('GET /api/v1/cart?view=mini — mini payload p95', async () => {
    for (let i = 0; i < 10; i += 1) {
      await h.app.inject({
        method: 'GET',
        url: '/api/v1/cart?view=mini',
        cookies: { b2b_cart_anon: anonToken },
      });
    }

    const samples: number[] = [];
    let minLines = Number.POSITIVE_INFINITY;
    for (let i = 0; i < iterations; i += 1) {
      const t0 = performance.now();
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/cart?view=mini',
        cookies: { b2b_cart_anon: anonToken },
      });
      samples.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
      minLines = Math.min(minLines, lineCountOf(res.json()));
    }

    summary('cart-mini', samples, miniBudget, `lines=${minLines}`);
    expect(minLines).toBe(cartLines);
    expect(percentile(samples, 0.95)).toBeLessThan(miniBudget);
  }, 10 * 60_000);

  it('GET /api/v1/cart/upsells — up-sell strip p95', async () => {
    for (let i = 0; i < 10; i += 1) {
      await h.app.inject({
        method: 'GET',
        url: '/api/v1/cart/upsells',
        cookies: { b2b_cart_anon: anonToken },
      });
    }

    const samples: number[] = [];
    let minCandidates = Number.POSITIVE_INFINITY;
    for (let i = 0; i < iterations; i += 1) {
      const t0 = performance.now();
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/cart/upsells',
        cookies: { b2b_cart_anon: anonToken },
      });
      samples.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: unknown[] };
      minCandidates = Math.min(minCandidates, body.data.length);
    }

    summary('cart-upsells', samples, upsellBudget, `candidates=${minCandidates}`);
    expect(minCandidates).toBe(upsellTargets);
    expect(percentile(samples, 0.95)).toBeLessThan(upsellBudget);
  }, 10 * 60_000);
});
