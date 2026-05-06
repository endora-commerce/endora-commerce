import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../helpers/test-server.js';
import { DictionaryCache } from '../../src/modules/dictionaries/services/dictionary-cache.js';
import { DictionaryReadService } from '../../src/modules/dictionaries/services/dictionary-read-service.js';

const shouldRun = process.env['PERF_RUN'] === 'true';
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '100');
const p95WarmBudget = Number(process.env['PERF_P95_WARM_MS'] ?? '5');
const p95ColdBudget = Number(process.env['PERF_P95_COLD_MS'] ?? '50');

describe.skipIf(!shouldRun)('dictionary registry — p95 latency', () => {
  let h: BackendServerHandle;
  let service: DictionaryReadService;
  let cache: DictionaryCache;

  beforeAll(async () => {
    h = await setupBackendServer();
    cache = new DictionaryCache(h.redis);
    service = new DictionaryReadService(() => h.em(), cache);
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('warm registry path stays under the p95 budget', async () => {
    await cache.invalidateAll();
    await service.getRegistry({ locale: 'pl-PL' });

    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      await service.getRegistry({ locale: 'pl-PL' });
      samples.push(performance.now() - t0);
    }
    const p95 = quantile(samples, 0.95);
    process.stdout.write(
      `[perf dictionary warm] iterations=${iterations} p95=${p95.toFixed(2)}ms (budget ${p95WarmBudget}ms)\n`,
    );
    expect(p95).toBeLessThan(p95WarmBudget);
  }, 60_000);

  it('cold registry path stays under the p95 budget', async () => {
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      await cache.invalidateAll();
      const t0 = performance.now();
      await service.getRegistry({ locale: 'pl-PL' });
      samples.push(performance.now() - t0);
    }
    const p95 = quantile(samples, 0.95);
    process.stdout.write(
      `[perf dictionary cold] iterations=${iterations} p95=${p95.toFixed(2)}ms (budget ${p95ColdBudget}ms)\n`,
    );
    expect(p95).toBeLessThan(p95ColdBudget);
  }, 60_000);
});

function quantile(samples: number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx]!;
}
