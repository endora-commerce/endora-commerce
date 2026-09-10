import { getHeapStatistics } from 'node:v8';

import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Heap ceiling for the suite — the guard that turns an out-of-memory death into
 * a failing assertion.
 *
 * Feature 072's first full-suite run died with `JavaScript heap out of memory`
 * at file 66 of 920, in the single fork every test file shares. The cause was
 * not an undisposed scope: `openPlatformScopeCount()` read 0 after every batch
 * throughout the leak. An `AsyncLocalStorage` store stays reachable for as long
 * as *any* async resource created inside it does — one pooled database
 * connection was enough to pin an entire Fastify request/response graph — so
 * "every scope was disposed" is not evidence that memory was released, and a
 * leak of this shape is invisible to every other check in this repository.
 *
 * Two numbers are asserted, because they fail for different reasons:
 *
 *  1. **Retention per composition cycle.** Boot a server, drive requests
 *     through the request-scope hook, tear it down, and see what survives a
 *     forced GC. A request that pins its own graph shows up here immediately,
 *     linear in the request count, whatever else the suite is doing. Measured
 *     after a warm-up cycle, so it does not depend on where this file lands in
 *     the run order.
 *  2. **Absolute post-GC live set.** The number that actually reaches the V8
 *     old-space limit. It depends on how many files ran before this one, so it
 *     is a sample rather than a constant — a ceiling with real headroom, not a
 *     regression bound. In a targeted run it is trivially satisfied; in the
 *     full suite it is the trajectory guard.
 *
 * Measurement procedure is the one used for the numbers in
 * `specs/072-module-kernel-di/baseline.md`: five `global.gc()` passes 200 ms
 * apart, then `process.memoryUsage().heapUsed`.
 */

/** Requests per measured cycle. Large enough that per-request retention is unmistakable. */
const REQUESTS_PER_CYCLE = 1_000;

/**
 * Measured 2026-08-11 on `fix/test-suite-health` (924 test files, kernel request
 * scope as merged in T026–T038), 16-CPU workstation:
 *
 * | Run | Retained per cycle | Post-GC live set |
 * | --- | --- | --- |
 * | This file alone, five consecutive runs | **2.3 MB** (2.3–2.5) | **275 MB** (275.0–275.2) |
 * | `test/integration/{catalog,kernel}`, 18 files | 2.2 MB | 404 MB |
 * | Full suite, 924 files, this file at ~244 | **−235.7 MB** | **1228.7 MB** |
 *
 * Calibration, so the next reader can tell a regression from drift: pinning each
 * request/reply pair in a module-level array — the exact shape of the original
 * leak — moves "retained per cycle" to 17.9 MB at 500 requests and **24.4 MB**
 * at 1 000, while the clean number stays at 2.3 MB at both counts. Not scaling
 * with the request count is the property being guarded.
 *
 * **The negative full-suite figure is not a measurement error, and it is why the
 * two assertions are not interchangeable.** By file 244 the fork holds hundreds
 * of files' worth of state, some of which only becomes collectible while this
 * test is composing its own servers; the second GC then reclaims memory the
 * first could not, and the delta goes strongly negative. So at full-suite scale
 * the retention delta is a lower bound polluted by other files, sensitive to
 * ±200 MB of noise — it cannot fail spuriously, but it cannot catch a 25 MB leak
 * there either. Run this file on its own to use it as an instrument.
 *
 * The two ceilings are therefore set on different principles:
 *
 *   - `RETAINED_PER_CYCLE_CEILING_MB` is a regression bound on a number that is
 *     stable to ±0.2 MB **in an isolated run**. Phase 4 of feature 072 converts
 *     66 modules into container registrations; those die with the container, so
 *     this number should stay flat. If it moves, that is the finding.
 *   - `LIVE_SET_CEILING_MB` is a tripwire, not a bound. Its value depends on how
 *     many files ran before this one, and vitest's sequencer orders files by
 *     size, so the position is not stable enough to bound tightly. It is set
 *     with headroom to the *failure mode* rather than to the measurement: the
 *     job is to fail the build with a legible message instead of letting the
 *     fork die with `FATAL ERROR: Ineffective mark-compacts near heap limit` and
 *     no diagnosis. Which limit that is, and why it is no longer written down,
 *     is on the constant itself. Note the limitation this shares with any
 *     file-resident guard: a leak steep enough to exhaust the heap *before* file
 *     244 still kills the run first — issue #199 is that case, and
 *     `test/heap-headroom.ts` is the answer to it.
 */
const RETAINED_PER_CYCLE_CEILING_MB = 15;

/**
 * **A tripwire above the failure point is not a tripwire** (issue #199).
 *
 * `3_072` was written against "the 4 GB old-space limit that killed the run".
 * The `test:backend` shards give the process `--max-old-space-size=2048`, so
 * under the configuration this number exists to protect, the fork dies of the
 * heap 1.2 GB before the assertion can say so — which is exactly what happened
 * in pipeline 11478, on three shards, with this file sharded into one of the two
 * that survived. The number is therefore derived from the limit the process
 * actually has, and the constant is kept as the cap for a run that has no
 * explicit limit at all.
 *
 * The remaining gap is structural and is the reason this is no longer the only
 * guard: a file-resident ceiling is read once, in whichever shard the sequencer
 * puts the file in, at whatever position it lands. `test/heap-headroom.ts` takes
 * the same reading after **every** file of **every** shard; this one stays
 * because its first assertion — retention per composition cycle — is an
 * instrument no per-file reading can replace.
 */
const LIVE_SET_CEILING_MB = Math.min(
  3_072,
  Math.round((getHeapStatistics().heap_size_limit * 0.9) / (1024 * 1024)),
);

const MB = 1024 * 1024;

const DIAGNOSIS =
  'Suspect retention through an AsyncLocalStorage store, not an undisposed scope: ' +
  'openPlatformScopeCount() reads 0 while this shape leaks. A store stays reachable ' +
  'as long as any async resource created inside it does, so a closure that shares a V8 ' +
  'context with the request handler, or a pooled connection captured in the store, pins ' +
  'the whole request/response graph. See specs/072-module-kernel-di/baseline.md.';

function forceGc(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc !== 'function') {
    throw new Error(
      'global.gc is unavailable — this measurement is meaningless without a forced GC. ' +
        'Run vitest through backend/vitest.config.ts, which passes --expose-gc to the fork pool.',
    );
  }
  gc();
}

/** Post-GC `heapUsed`: live data, not garbage. */
async function postGcHeapUsed(): Promise<number> {
  for (let pass = 0; pass < 5; pass += 1) {
    forceGc();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return process.memoryUsage().heapUsed;
}

/**
 * One full composition cycle: boot, drive `REQUESTS_PER_CYCLE` requests that
 * each open a request scope and touch the database, tear down.
 */
async function runCompositionCycle(): Promise<void> {
  let emFactory: (() => EntityManager) | null = null;
  const h: BackendServerHandle = await setupBackendServer({
    seed: 'none',
    extraModules: [
      async (app) => {
        app.get('/api/v1/_test/heap/probe', async () => {
          // A real query, so the request scope holds a pooled connection —
          // the async resource that kept the store alive in the original leak.
          const em = emFactory?.();
          const channels = em ? await em.count(SalesChannel, {}) : 0;
          return { data: { channels } };
        });
      },
    ],
  });
  emFactory = h.em;
  try {
    for (let i = 0; i < REQUESTS_PER_CYCLE; i += 1) {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/_test/heap/probe' });
      if (res.statusCode !== 200) {
        throw new Error(`probe request ${i} returned ${res.statusCode}: ${res.body}`);
      }
    }
  } finally {
    await teardownBackendServer(h);
  }
}

describe('Heap ceiling (feature 072)', () => {
  it('does not retain request-sized graphs across a composition cycle', async () => {
    // Warm-up cycle: pays for the process-wide singletons a first boot creates
    // (ORM metadata, manifest registries, i18n bundles) so the measured cycle
    // reports marginal retention wherever this file lands in the run order.
    await runCompositionCycle();
    const before = await postGcHeapUsed();

    await runCompositionCycle();
    const after = await postGcHeapUsed();

    const retainedMb = Math.round(((after - before) / MB) * 10) / 10;
    const liveSetMb = Math.round((after / MB) * 10) / 10;
    // Reported unconditionally: the value matters even when it passes, because
    // drift is only readable against the numbers recorded above.
    process.stdout.write(
      `[heap-ceiling] retained per cycle: ${retainedMb} MB (ceiling ${RETAINED_PER_CYCLE_CEILING_MB} MB), ` +
        `post-GC live set: ${liveSetMb} MB (ceiling ${LIVE_SET_CEILING_MB} MB), ` +
        `${REQUESTS_PER_CYCLE} requests per cycle\n`,
    );

    expect(
      retainedMb,
      `${REQUESTS_PER_CYCLE} requests retained ${retainedMb} MB after teardown and a forced GC, ` +
        `over the ${RETAINED_PER_CYCLE_CEILING_MB} MB ceiling. ${DIAGNOSIS}`,
    ).toBeLessThan(RETAINED_PER_CYCLE_CEILING_MB);

    expect(
      liveSetMb,
      `post-GC live set is ${liveSetMb} MB, over the ${LIVE_SET_CEILING_MB} MB ceiling. ` +
        `The suite shares one fork, so this is the number that ends the run with ` +
        `"JavaScript heap out of memory". ${DIAGNOSIS}`,
    ).toBeLessThan(LIVE_SET_CEILING_MB);
  }, 180_000);
});
