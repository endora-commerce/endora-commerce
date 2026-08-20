import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from '@mikro-orm/postgresql';
import type { DictionaryRegistryResponse } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../helpers/test-server.js';
import { DictionaryCache } from '../../src/modules/dictionaries/services/dictionary-cache.js';
import { DictionaryReadService } from '../../src/modules/dictionaries/services/dictionary-read-service.js';
import { dictionaryReadPortsFor } from '../helpers/dictionary-services.js';

/**
 * Dictionary registry perf harness.
 *
 * The two scenarios are the registry read with the Redis payload present
 * (warm) and with it dropped (cold, so the read rebuilds the payload from the
 * country / currency / language tables and resolves a label per entry).
 *
 * Both assert the payload they built before they assert how long it took
 * (issue #140): the registry is reference data supplied by migrations, and a
 * read over three empty tables answers a well-formed, empty and very fast
 * registry. `entriesFor` is what tells "nothing to do" apart from "quick".
 *
 * The cold scenario also counts the statements it issued (issue #142). It used
 * to resolve one label per entry — ~170 sequential round trips for a 72-entry
 * registry, and growing with the dictionary — which is what put it over its own
 * 50 ms budget. The build is a constant seven statements now, and the budget is
 * tightened to the reality that buys: p95 16-21 ms locally, against 86 ms
 * before. The statement ceiling is the machine-independent half of the
 * assertion; the p95 is the half an operator feels.
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '100');
const p95WarmBudget = Number(process.env['PERF_P95_WARM_MS'] ?? '5');
const p95ColdBudget = Number(process.env['PERF_DICTIONARY_COLD_P95_MS'] ?? '30');
/** Statements one cold build may issue: the channel, four tables, the fallback languages, the translations. */
const coldStatementCeiling = Number(process.env['PERF_COLD_STATEMENTS'] ?? '7');
/**
 * Entries the seeded reference data answers with (70 countries plus the default
 * channel's one currency and one language). A number under this means the read
 * was measured over something other than the registry, and neither budget below
 * says anything about a registry that was not there (issue #140).
 */
const seededEntryFloor = 50;

describe.skipIf(!shouldRun)('dictionary registry — p95 latency', () => {
  let h: BackendServerHandle;
  let service: DictionaryReadService;
  let cache: DictionaryCache;

  beforeAll(async () => {
    h = await setupBackendServer();
    cache = new DictionaryCache(h.redis);
    const ports = dictionaryReadPortsFor(() => h.em());
    service = new DictionaryReadService(() => h.em(), ports.currencies, ports.languages, cache);
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('warm registry path stays under the p95 budget', async () => {
    await cache.invalidateAll();
    await service.getRegistry({ locale: 'pl-PL' });

    const samples: number[] = [];
    let minEntries = Number.POSITIVE_INFINITY;
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      const registry = await service.getRegistry({ locale: 'pl-PL' });
      samples.push(performance.now() - t0);
      minEntries = Math.min(minEntries, entriesFor(registry));
    }
    const p95 = quantile(samples, 0.95);
    process.stdout.write(
      `[perf dictionary warm] iterations=${iterations} entries=${minEntries} ` +
        `p95=${p95.toFixed(2)}ms (budget ${p95WarmBudget}ms)\n`,
    );
    expect(minEntries).toBeGreaterThanOrEqual(seededEntryFloor);
    expect(p95).toBeLessThan(p95WarmBudget);
  }, 60_000);

  it('cold registry path stays under the p95 budget', async () => {
    const knex: Knex = h.em().getConnection().getKnex();
    let statements = 0;
    const countStatement = (): void => {
      statements += 1;
    };

    const samples: number[] = [];
    let minEntries = Number.POSITIVE_INFINITY;
    for (let i = 0; i < iterations; i++) {
      await cache.invalidateAll();
      knex.on('query', countStatement);
      const t0 = performance.now();
      const registry = await service.getRegistry({ locale: 'pl-PL' });
      samples.push(performance.now() - t0);
      knex.off('query', countStatement);
      minEntries = Math.min(minEntries, entriesFor(registry));
    }
    const perBuild = statements / iterations;
    const p95 = quantile(samples, 0.95);
    process.stdout.write(
      `[perf dictionary cold] iterations=${iterations} entries=${minEntries} ` +
        `statements/build=${perBuild.toFixed(1)} (ceiling ${coldStatementCeiling}) ` +
        `p95=${p95.toFixed(2)}ms (budget ${p95ColdBudget}ms)\n`,
    );
    expect(minEntries).toBeGreaterThanOrEqual(seededEntryFloor);
    // Issue #142 — what the build cost, before how long it took. A count that
    // tracks `minEntries` is the N+1 back, whatever the clock says on the day.
    expect(perBuild).toBeLessThanOrEqual(coldStatementCeiling);
    expect(p95).toBeLessThan(p95ColdBudget);
  }, 60_000);
});

/** Entries the registry actually resolved — the work the budget is about. */
function entriesFor(registry: DictionaryRegistryResponse): number {
  const { countries, currencies, languages } = registry.data;
  return countries.length + currencies.length + languages.length;
}

function quantile(samples: number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx]!;
}
