import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineModuleSettingsManifest } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../helpers/test-server.js';
import { ManifestReconciler } from '../../src/kernel/settings/manifest-reconciler.js';
import { Setting } from '../../src/kernel/settings/setting.entity.js';
import { SalesChannel } from '../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * Settings universal-getter perf harness (T055 / plan.md performance
 * goals).
 *
 * Targets (per plan.md):
 *   - cached path:   < 5 ms p95 (LRU + Redis)
 *   - cold path:     < 30 ms p95 (Postgres single-row lookup)
 *
 * ## Cold means both layers, not one (issue #140)
 *
 * {@link SettingsCache} is two layers: a per-process LRU in front of Redis.
 * Deleting the Redis key by hand — which is what this file used to do —
 * leaves the LRU holding the value, so every "cold" read was answered from
 * process memory and the two scenarios reported the same number. The cold
 * loop now goes through `cache.invalidate(code)`, the one operation that
 * evacuates both layers, and the run asserts the cache really is empty before
 * it starts timing: a cold-path benchmark that is secretly warm is a budget
 * met by measuring the wrong thing.
 *
 * Both scenarios also assert the value the read produced, so a setting that
 * stopped resolving cannot be reported as a fast one.
 *
 * Tuning knobs (env):
 *   PERF_RUN              — set to 'true' to run; otherwise skipped.
 *   PERF_ITERATIONS       — total reads per scenario (default 1000)
 *   PERF_P95_CACHED_MS    — cached-path budget (default 5)
 *   PERF_P95_COLD_MS      — cold-path budget (default 50 — slacker than the
 *                            5-ms-cached / 30-ms-cold targets to absorb
 *                            shared-CI variance; tighten on dedicated infra).
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '1000');
const p95CachedBudget = Number(process.env['PERF_P95_CACHED_MS'] ?? '5');
const p95ColdBudget = Number(process.env['PERF_P95_COLD_MS'] ?? '50');

const CODE = 'perf_settings.url';
const SEEDED_VALUE = 'https://default.example';

describe.skipIf(!shouldRun)('settings universal getter — p95 latency', () => {
  let h: BackendServerHandle;
  let channelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await new ManifestReconciler(h.em()).apply([
      defineModuleSettingsManifest({
        moduleCode: 'perf_settings',
        groups: [],
        settings: [
          {
            code: CODE,
            name: 'URL',
            valueType: 'string',
            defaultValue: SEEDED_VALUE,
          },
        ],
      }),
    ]);
    const channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    channelId = channel.id;
  }, 60_000);

  afterAll(async () => {
    const em = h.em();
    for (const s of await em.find(Setting, { ownerModule: 'perf_settings' })) em.remove(s);
    await em.flush();
    h.settings.cacheInvalidator?.dispose();
    await teardownBackendServer(h);
  });

  it('cached path stays under the budget', async () => {
    // Warm: prime the cache with one read.
    await h.settings.settingsService.get(CODE, channelId, z.string());
    // The scenario's own precondition: the reads below are cache hits.
    expect((await h.settings.cache.get(CODE, channelId)).hit).toBe(true);

    const samples: number[] = [];
    let reads = 0;
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      const value = await h.settings.settingsService.get(CODE, channelId, z.string());
      samples.push(performance.now() - t0);
      if (value === SEEDED_VALUE) reads += 1;
    }
    const p95 = quantile(samples, 0.95);
    process.stdout.write(
      `[perf settings cached] iterations=${iterations} resolved=${reads} ` +
        `p95=${p95.toFixed(2)}ms (budget ${p95CachedBudget}ms)\n`,
    );
    expect(reads).toBe(iterations);
    expect(p95).toBeLessThan(p95CachedBudget);
  }, 60_000);

  it('cold path stays under the budget', async () => {
    // Prove the drop this loop relies on evacuates both layers. `redis.del`
    // alone leaves the per-process LRU holding the value, and the loop below
    // then times the LRU while reporting a Postgres number.
    await h.settings.cache.invalidate(CODE);
    expect((await h.settings.cache.get(CODE, channelId)).hit).toBe(false);

    const samples: number[] = [];
    let reads = 0;
    for (let i = 0; i < iterations; i++) {
      // Drop both layers before each iteration to force the Postgres path.
      await h.settings.cache.invalidate(CODE);
      const t0 = performance.now();
      const value = await h.settings.settingsService.get(CODE, channelId, z.string());
      samples.push(performance.now() - t0);
      if (value === SEEDED_VALUE) reads += 1;
    }
    const p95 = quantile(samples, 0.95);
    process.stdout.write(
      `[perf settings cold] iterations=${iterations} resolved=${reads} ` +
        `p95=${p95.toFixed(2)}ms (budget ${p95ColdBudget}ms)\n`,
    );
    expect(reads).toBe(iterations);
    expect(p95).toBeLessThan(p95ColdBudget);
  }, 60_000);
});

function quantile(samples: number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx]!;
}
