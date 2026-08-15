import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  defineModuleWorker,
  pauseWorkersFor,
  resumeWorkersFor,
} from '../../../src/modules/_lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';

/**
 * Integration test for FR-015 — disable pauses BullMQ workers (US3).
 *
 * Workers registered via `defineModuleWorker(moduleId, worker)` MUST
 * be added to the per-module registry; `pauseWorkersFor(moduleId)`
 * MUST call `worker.pause()` on every registered worker;
 * `resumeWorkersFor` re-runs `worker.resume()`.
 *
 * Uses an in-memory worker stub instead of a real BullMQ Worker to
 * keep the test focused on the wrapper behaviour. A separate
 * end-to-end test against a real Redis-backed BullMQ queue belongs in
 * the workers' own module if/when one ships.
 */

describe('defineModuleWorker — pause/resume on disable/enable (integration)', () => {
  let pauseCalls = 0;
  let resumeCalls = 0;

  type FakeWorker = { pause: () => Promise<void>; resume: () => Promise<void> };

  function makeFakeWorker(): FakeWorker {
    return {
      pause: async () => {
        pauseCalls++;
      },
      resume: async () => {
        resumeCalls++;
      },
    };
  }

  beforeAll(() => {
    // Module starts enabled.
    registryCache.__setEnabledForTesting(['fixture_workers']);
    const w1 = makeFakeWorker();
    const w2 = makeFakeWorker();
    defineModuleWorker('fixture_workers', w1 as never);
    defineModuleWorker('fixture_workers', w2 as never);
  });

  beforeEach(() => {
    pauseCalls = 0;
    resumeCalls = 0;
  });

  afterEach(() => {
    registryCache.__setEnabledForTesting([]);
  });

  afterAll(() => {
    // Reset shared singleton state for other tests.
    registryCache.__setEnabledForTesting([]);
  });

  it('pauseWorkersFor calls pause() on every registered worker', async () => {
    await pauseWorkersFor('fixture_workers');
    expect(pauseCalls).toBe(2);
    expect(resumeCalls).toBe(0);
  });

  it('resumeWorkersFor calls resume() on every registered worker', async () => {
    await resumeWorkersFor('fixture_workers');
    expect(resumeCalls).toBe(2);
  });
});
