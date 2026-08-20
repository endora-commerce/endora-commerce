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
 * ## The budget, and the assertion that does not need one (issue #143, D-65)
 *
 * D-65: "A microsecond p95 inside a docker executor is dominated by GC and
 * scheduler jitter. Either re-base it generously from three recorded runs or
 * convert it to what it is really asserting — that the enabled check is O(1)
 * and touches no I/O — which a shape assertion can make deterministically and
 * a stopwatch cannot." Both, because they catch different things.
 *
 * Measured 2026-08-17 over four runs on a 16-core / 64 GB Linux dev box, load
 * average 1.7-3.6: p95 0.84 / 0.77 / 0.97 / 1.67 µs. The budget is **25 µs**,
 * down from 100 — 15× the worst reading rather than the ×3 the millisecond
 * benchmarks in this suite use, because at this scale a single GC pause is
 * larger than the whole measurement and a ×3 budget would fail on the runner's
 * mood rather than on the code.
 *
 * That generosity is what the third test exists to make up for. It times the
 * same lookup over a 50-member and a 5000-member registry and asserts the
 * ratio, which is what "O(1)" means and is the one claim here a busy machine
 * cannot fake: contention slows both halves together and cancels out of a
 * ratio, while a `Set` swapped for a linear scan — or for a Redis hop keyed by
 * the set — moves it by two orders of magnitude and is invisible to a 25 µs
 * ceiling. Same shape as #142's statement-count assertion beside the
 * dictionary p95.
 *
 * Skipped by default; run with `PERF_RUN=true pnpm --filter backend run test:perf`.
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '100000');
const p95Budget = Number(process.env['PERF_P95_US'] ?? '25');
/** Registry sizes the O(1) check compares, and the ratio it allows between them. */
const SCALE_SMALL = 50;
const SCALE_LARGE = 5_000;
const SCALE_RATIO_CEILING = Number(process.env['PERF_ENABLED_SCALE_RATIO'] ?? '4');

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

  it('costs the same over a 100× larger registry — the O(1) claim', () => {
    /** Mean nanoseconds per `isEnabled` over a registry of `size` members. */
    const meanNsPerLookup = (size: number): number => {
      const cache = new ModuleRegistryCache();
      const ids = Array.from({ length: size }, (_, i) => `mod_${i}`);
      cache.__setEnabledForTesting(ids);

      // Half hits, half misses, and the hits sweep the whole set — a linear
      // scan pays for the set's size only if the probe reaches its far end.
      const probes = Array.from({ length: 20_000 }, (_, i) =>
        i % 2 === 0 ? `mod_${(i * 7) % size}` : `mod_absent_${i}`,
      );

      let hits = 0;
      // Warm the call site so the comparison is JIT-steady on both sides.
      for (const id of probes) if (cache.isEnabled(id)) hits += 1;

      hits = 0;
      const t0 = process.hrtime.bigint();
      for (const id of probes) if (cache.isEnabled(id)) hits += 1;
      const t1 = process.hrtime.bigint();

      // What was measured, before how long it took: half the probes matched.
      expect(hits).toBe(probes.length / 2);
      return Number(t1 - t0) / probes.length;
    };

    const small = meanNsPerLookup(SCALE_SMALL);
    const large = meanNsPerLookup(SCALE_LARGE);
    const ratio = large / small;

    process.stdout.write(
      `[enabled-check scale] ${SCALE_SMALL}=${small.toFixed(1)}ns ` +
        `${SCALE_LARGE}=${large.toFixed(1)}ns ratio=${ratio.toFixed(2)} ` +
        `(ceiling ${SCALE_RATIO_CEILING})\n`,
    );

    // A hash lookup answers both in the same time, so the ratio sits near 1.
    // A linear scan over the enabled set would put it near 100, and an I/O hop
    // added to the hot path would put it wherever the network is. Neither is
    // something the microsecond budget above can see.
    expect(ratio).toBeLessThan(SCALE_RATIO_CEILING);
  });
});
