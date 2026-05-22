import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CartItem } from '../../../src/modules/carts/entities/cart-item.entity.js';

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
 * Env knobs:
 *   PERF_CART_LINES           — lines seeded on the test cart (default 50)
 *   PERF_ITERATIONS           — request count per scenario (default 100)
 *   PERF_FULL_P95_BUDGET_MS   — GET /api/v1/cart budget (default 200)
 *   PERF_MINI_P95_BUDGET_MS   — GET /api/v1/cart?view=mini budget (default 80)
 *   PERF_UPSELL_P95_BUDGET_MS — GET /api/v1/cart/upsells budget (default 150)
 *   PERF_RUN                  — 'true' to enable
 */

const cartLines = Number(process.env['PERF_CART_LINES'] ?? '50');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '100');
const fullBudget = Number(process.env['PERF_FULL_P95_BUDGET_MS'] ?? '200');
const miniBudget = Number(process.env['PERF_MINI_P95_BUDGET_MS'] ?? '80');
const upsellBudget = Number(process.env['PERF_UPSELL_P95_BUDGET_MS'] ?? '150');
const shouldRun = process.env['PERF_RUN'] === 'true';

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

function summary(label: string, samples: number[], budget: number): void {
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  const p99 = percentile(samples, 0.99);
  // eslint-disable-next-line no-console
  console.log(
    `[perf/${label}] iterations=${samples.length} ` +
      `p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms ` +
      `budget=${budget}ms`,
  );
}

describe.skipIf(!shouldRun)('cart routes — storefront perf', () => {
  let h: BackendServerHandle;
  let cartId: string;
  const anonToken = `perf-cart-${Date.now()}`;

  beforeAll(async () => {
    h = await setupBackendServer();

    const seed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(seed.statusCode).toBe(200);
    cartId = (seed.json() as { data: { id: string } }).data.id;

    const em = h.em();
    const linesToAdd = Math.max(0, cartLines - 1);
    for (let i = 0; i < linesToAdd; i += 1) {
      em.create(CartItem, {
        cartId,
        productId: '00000000-0000-4000-8000-000000000101',
        variantId: randomUUID(),
        quantity: 1,
        unitPrice: '1.00',
        currency: 'PLN',
      });
    }
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
    for (let i = 0; i < iterations; i += 1) {
      const t0 = performance.now();
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/cart',
        cookies: { b2b_cart_anon: anonToken },
      });
      samples.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
    }

    summary('cart-full', samples, fullBudget);
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
    for (let i = 0; i < iterations; i += 1) {
      const t0 = performance.now();
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/cart?view=mini',
        cookies: { b2b_cart_anon: anonToken },
      });
      samples.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
    }

    summary('cart-mini', samples, miniBudget);
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
    for (let i = 0; i < iterations; i += 1) {
      const t0 = performance.now();
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/cart/upsells',
        cookies: { b2b_cart_anon: anonToken },
      });
      samples.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
    }

    summary('cart-upsells', samples, upsellBudget);
    expect(percentile(samples, 0.95)).toBeLessThan(upsellBudget);
  }, 10 * 60_000);
});
