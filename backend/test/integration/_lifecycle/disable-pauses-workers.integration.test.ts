import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  defineModuleWorker,
  pauseWorkersFor,
  resumeWorkersFor,
  resetModuleWorkersForTesting,
} from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { makeFakeModuleWorker, type FakeModuleWorker } from '../../helpers/fake-module-worker.js';

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
 *
 * Issue #141 — the two helpers are deliberately presence-*blind*: they are the
 * orchestrator's imperative half, called after it has already decided the
 * module's state, and they pause whatever is registered. So a file that only
 * called them ran entirely with `fixture_workers` switched **on** while
 * claiming to be about disable, and could not have failed if the state had gone
 * the other way. Each call now runs in the state that produces it — the pause in
 * the off state, the resume in the on state — and `withModuleOff` asserts the
 * off state took, so the seam that *is* state-driven (`defineModuleWorker`'s own
 * decision at registration) is exercised in the same window.
 *
 * Since the Principle XVII worker repair the assertions are over the workers'
 * **paused state** rather than over how many times `pause()` was called. The
 * presence install now reconciles every registered worker on its own, so a call
 * count measures how often presence moved rather than what the helper did; the
 * state is what the two mechanisms have to agree on, and it is what an operator
 * would see.
 */

describe('defineModuleWorker — pause/resume on disable/enable (integration)', () => {
  let workers: FakeModuleWorker[] = [];

  const allPaused = (): boolean => workers.every((w) => w.state.paused);
  const nonePaused = (): boolean => workers.every((w) => !w.state.paused);

  beforeAll(() => {
    resetModuleWorkersForTesting();
    // Module starts enabled, so neither worker is paused at registration.
    registryCache.__setEnabledForTesting(['fixture_workers']);
    workers = [makeFakeModuleWorker(), makeFakeModuleWorker()];
    for (const w of workers) defineModuleWorker('fixture_workers', w.worker);
    expect(nonePaused(), 'a present module had its workers paused at registration').toBe(true);
  });

  beforeEach(() => {
    // `withModuleOff` flips against the set the caller already has, so each
    // case restates the on state it starts from.
    registryCache.__setEnabledForTesting(['fixture_workers']);
  });

  afterEach(() => {
    registryCache.__setEnabledForTesting([]);
  });

  afterAll(() => {
    // Reset shared singleton state for other tests.
    resetModuleWorkersForTesting();
    registryCache.__setEnabledForTesting([]);
  });

  it('pauses every registered worker of a module the operator switched off', async () => {
    await withModuleOff('fixture_workers', 'deactivated', async () => {
      await pauseWorkersFor('fixture_workers');
      expect(allPaused()).toBe(true);
    });
  });

  it('starts a worker paused when it registers while its module is off', async () => {
    // The state-driven half — `defineModuleWorker`'s own decision, with nobody
    // calling the helper. A separate module id, seeded on and then switched off,
    // so the pause can only have come from the flip: a worker of a module that
    // was *never* enabled would pause too, and prove nothing about disable.
    registryCache.__setEnabledForTesting(['fixture_workers', 'fixture_workers_late']);
    const late = makeFakeModuleWorker();
    await withModuleOff('fixture_workers_late', 'deactivated', async () => {
      defineModuleWorker('fixture_workers_late', late.worker);
      await Promise.resolve();
      expect(late.state.paused, 'a worker registered while its module is off started running').toBe(
        true,
      );
    });
  });

  it('pauses them for a module the platform no longer offers either', async () => {
    await withModuleOff('fixture_workers', 'platform-unavailable', async () => {
      await pauseWorkersFor('fixture_workers');
      expect(allPaused()).toBe(true);
    });
  });

  it('resumeWorkersFor un-pauses every registered worker once it is back on', async () => {
    for (const w of workers) await w.worker.pause();
    expect(allPaused()).toBe(true);

    await resumeWorkersFor('fixture_workers');
    expect(nonePaused()).toBe(true);
  });
});
