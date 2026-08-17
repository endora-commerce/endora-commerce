import { describe, expect, it, beforeAll } from 'vitest';
import {
  ModuleRegistryCache,
  registryCache,
} from '../../../src/kernel/lifecycle/registry-cache.js';

/**
 * Per-request enabled-check microbenchmark — feature 018 / SC-003 hot path.
 *
 * `defineModuleRoutes` invokes `registryCache.isEnabled(moduleId)` on
 * every incoming request before a route handler runs. The benchmark
 * asserts that lookup stays well below the 100 µs p95 budget the spec
 * promises (a generous order-of-magnitude headroom over what `Set.has`
 * costs in V8 — the test guards against future regressions like
 * accidentally adding a Redis hop or a SQL fallback to the hot path).
 *
 * Both cases count the answers the lookup gave and assert that count before
 * they assert the latency (issue #140). The population is seeded through
 * `__setEnabledForTesting`, and a lookup over an *empty* registry is the
 * cheapest thing in this file — so a seeding helper that stopped applying
 * would be reported as a record-breaking hot path rather than as a hole.
 *
 * Skipped by default; run with `PERF_RUN=true pnpm --filter backend run test:perf`.
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '100000');
const p95Budget = Number(process.env['PERF_P95_US'] ?? '100');

describe.skipIf(!shouldRun)('module-lifecycle enabled-check — p95 latency', () => {
  beforeAll(() => {
    // Seed a realistically-sized enabled set (50 modules — SC-005).
    const ids = Array.from({ length: 50 }, (_, i) => `mod_${i}`);
    registryCache.__setEnabledForTesting(ids);
  });

  it('isEnabled stays under the p95 budget', () => {
    const samples = new Float64Array(iterations);
    let hits = 0;
    for (let i = 0; i < iterations; i++) {
      // 50% hit, 50% miss — closer to the production mix where both
      // domain modules and absent ids are queried.
      const id = i % 2 === 0 ? `mod_${i % 50}` : `mod_absent_${i}`;
      const t0 = process.hrtime.bigint();
      const enabled = registryCache.isEnabled(id);
      const t1 = process.hrtime.bigint();
      samples[i] = Number(t1 - t0) / 1000; // ns → µs
      if (enabled) hits += 1;
    }
    samples.sort();
    const p50 = samples[Math.floor(iterations * 0.5)]!;
    const p95 = samples[Math.floor(iterations * 0.95)]!;
    const p99 = samples[Math.floor(iterations * 0.99)]!;
    process.stdout.write(
      `[enabled-check perf] iterations=${iterations} hits=${hits} p50=${p50.toFixed(2)}µs ` +
        `p95=${p95.toFixed(2)}µs p99=${p99.toFixed(2)}µs ` +
        `budget=${p95Budget}µs\n`,
    );
    // What was measured, before how long it took: half the lookups found a
    // member, half did not. An empty registry answers every call in less time
    // than a populated one takes to find anything.
    expect(hits).toBe(Math.ceil(iterations / 2));
    expect(p95).toBeLessThan(p95Budget);
  });

  it('a fresh ModuleRegistryCache instance has the same characteristics', () => {
    const cache = new ModuleRegistryCache();
    cache.__setEnabledForTesting([
      'auth',
      'catalog',
      'orders',
      'blog',
      'search',
      'inventory',
    ]);

    const samples = new Float64Array(10_000);
    let hits = 0;
    for (let i = 0; i < 10_000; i++) {
      const t0 = process.hrtime.bigint();
      const enabled = cache.isEnabled('catalog');
      const t1 = process.hrtime.bigint();
      samples[i] = Number(t1 - t0) / 1000;
      if (enabled) hits += 1;
    }
    samples.sort();
    const p95 = samples[Math.floor(10_000 * 0.95)]!;
    expect(hits).toBe(10_000);
    expect(p95).toBeLessThan(p95Budget);
  });
});
