import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineModuleSettingsManifest } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../helpers/test-server.js';
import { ManifestReconciler } from '../../src/modules/settings/services/manifest-reconciler.js';
import { Setting } from '../../src/modules/settings/entities/setting.entity.js';
import { SalesChannel } from '../../src/modules/catalog/entities/sales-channel.entity.js';

/**
 * Settings universal-getter perf harness (T055 / plan.md performance
 * goals).
 *
 * Targets (per plan.md):
 *   - cached path:   < 5 ms p95 (LRU + Redis)
 *   - cold path:     < 30 ms p95 (Postgres single-row lookup)
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
            code: 'perf_settings.url',
            name: 'URL',
            valueType: 'string',
            defaultValue: 'https://default.example',
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
    await h.settings.settingsService.get('perf_settings.url', channelId, z.string());

    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      await h.settings.settingsService.get('perf_settings.url', channelId, z.string());
      samples.push(performance.now() - t0);
    }
    const p95 = quantile(samples, 0.95);
    process.stdout.write(
      `[perf settings cached] iterations=${iterations} p95=${p95.toFixed(2)}ms (budget ${p95CachedBudget}ms)\n`,
    );
    expect(p95).toBeLessThan(p95CachedBudget);
  }, 60_000);

  it('cold path stays under the budget', async () => {
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      // Drop the cache before each iteration to force the Postgres path.
      const keys = await h.redis.keys(`settings:v1:perf_settings.url:${channelId}`);
      if (keys.length > 0) await h.redis.del(...keys);
      const t0 = performance.now();
      await h.settings.settingsService.get('perf_settings.url', channelId, z.string());
      samples.push(performance.now() - t0);
    }
    const p95 = quantile(samples, 0.95);
    process.stdout.write(
      `[perf settings cold] iterations=${iterations} p95=${p95.toFixed(2)}ms (budget ${p95ColdBudget}ms)\n`,
    );
    expect(p95).toBeLessThan(p95ColdBudget);
  }, 60_000);
});

function quantile(samples: number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx]!;
}
