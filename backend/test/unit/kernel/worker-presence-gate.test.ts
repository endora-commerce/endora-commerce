import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RateLimitError } from 'bullmq';
import {
  defineModuleWorker,
  resetModuleWorkersForTesting,
} from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { makeFakeModuleWorker, type FakeModuleWorker } from '../../helpers/fake-module-worker.js';

/**
 * Constitution XVII — a module an operator switched off consumes no queue.
 *
 * The defect this file exists for: `pauseWorkersFor` was reached from the
 * lifecycle orchestrator's **platform-availability** `disable` and from nowhere
 * else, so a business operator's deactivation — the settings row plus the
 * `b2b:module:state-changed` publish — refreshed the registry cache, took the
 * routes to 503, and left the BullMQ consumer consuming. "A module that is off
 * behaves as if never installed — business logic, API, Admin UI and Storefront"
 * (Principle XVII), and a running queue consumer is business logic: for
 * `google_analytics` it meant events still going to Google after the operator
 * withdrew that disclosure.
 *
 * The repair is a **pull**, in two layers over one authority — the per-process
 * registry cache that every other gating seam already reads:
 *
 *  1. the **fetch** gate: every presence install reconciles every registered
 *     worker to `effectiveState.isPresent`, in whichever process registered it,
 *     so a worker in a `BACKEND_ROLE=worker` process stops when the flip was
 *     written by the API process (or by the CLI, which composes nothing at all
 *     and therefore has no worker registry to push into);
 *  2. the **work** gate: a job already fetched when presence flipped is not run.
 *     It is returned to the wait list, never failed and never dropped, which is
 *     what makes deactivation "non-destructive and reversible".
 *
 * Everything here runs against the shared stub on purpose — the two gates are
 * decisions over one in-memory value, and the real-Redis half (a job left
 * waiting while the module is off, drained when it comes back) is
 * `test/integration/_lifecycle/deactivation-stops-workers.integration.test.ts`.
 */

const MODULE_ID = 'fixture_gated_queue';

/** `pause()` is fired without `await` from the registration and the reconcile. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('a queue consumer follows its module`s effective state', () => {
  beforeEach(() => {
    resetModuleWorkersForTesting();
    registryCache.__setEnabledForTesting([MODULE_ID]);
  });

  afterEach(() => {
    resetModuleWorkersForTesting();
    registryCache.__setEnabledForTesting([]);
  });

  function register(processor?: () => Promise<unknown>): FakeModuleWorker {
    const fake = makeFakeModuleWorker(processor ? { processor: () => processor() } : {});
    defineModuleWorker(MODULE_ID, fake.worker);
    return fake;
  }

  describe('the fetch gate — presence installs reconcile every registered worker', () => {
    it('an operator deactivation pauses a worker that was already running', async () => {
      const fake = register();
      await settle();
      expect(fake.state.paused, 'a present module`s worker starts running').toBe(false);

      // Exactly what the activation path installs: the platform axis untouched,
      // the operator axis off. This is the flip that used to reach nothing.
      registryCache.__setEnabledForTesting([MODULE_ID], { deactivated: [MODULE_ID] });
      await settle();

      expect(fake.state.paused, 'a deactivated module`s worker kept consuming').toBe(true);
    });

    it('reactivation resumes it, so the jobs that piled up drain', async () => {
      const fake = register();
      registryCache.__setEnabledForTesting([MODULE_ID], { deactivated: [MODULE_ID] });
      await settle();
      expect(fake.state.paused).toBe(true);

      registryCache.__setEnabledForTesting([MODULE_ID]);
      await settle();

      expect(fake.state.paused, 'reactivation left the worker paused').toBe(false);
    });

    it('a platform-availability withdrawal pauses it too — the gate is the conjunction', async () => {
      const fake = register();
      await settle();

      registryCache.__setEnabledForTesting([]);
      await settle();

      expect(fake.state.paused).toBe(true);
    });

    it('acts only on a mismatch, so a presence install that changes nothing costs nothing', async () => {
      const fake = register();
      await settle();
      const before = fake.state.pauseCalls + fake.state.resumeCalls;

      registryCache.__setEnabledForTesting([MODULE_ID]);
      await settle();

      expect(fake.state.pauseCalls + fake.state.resumeCalls).toBe(before);
    });

    it('a pause that rejects is logged, not left as an unhandled rejection', async () => {
      // The reconcile runs inside a pub/sub callback and cannot await, so a
      // rejected `pause()` — `pause()` reconnects the blocking connection to
      // wait for the active job, and a closing connection rejects — would be a
      // crashed process rather than a message. Measured: the real-Redis
      // integration file produced one before this was handled.
      //
      // **How this goes red**, since the expectation below is about the call
      // rather than the rejection: with the handler removed, the rejection is
      // unhandled, vitest reports it as an *error* of the run and exits 1 —
      // measured, with the `.catch` deleted. An assertion inside the file cannot
      // see an unhandled rejection, which is the whole nature of the defect.
      const fake = makeFakeModuleWorker({
        pauseSettles: () => Promise.reject(new Error('Redis is already connecting/connected')),
      });
      defineModuleWorker(MODULE_ID, fake.worker);

      registryCache.__setEnabledForTesting([MODULE_ID], { deactivated: [MODULE_ID] });
      await settle();
      await settle();

      expect(fake.state.pauseCalls).toBe(1);
    });

    it('a closed worker leaves the registry, so a later reconcile does not resurrect it', async () => {
      const fake = register();
      fake.emit('closed');

      registryCache.__setEnabledForTesting([MODULE_ID], { deactivated: [MODULE_ID] });
      await settle();

      expect(fake.state.paused, 'the reconcile touched a worker that had been closed').toBe(false);
    });
  });

  describe('the work gate — a job fetched in the flip window is not run', () => {
    it('runs the module`s own processor while the module is present', async () => {
      let ran = 0;
      const fake = register(async () => {
        ran += 1;
        return 'ok';
      });

      await expect(fake.process()).resolves.toBe('ok');
      expect(ran).toBe(1);
    });

    it('does not run it while the module is absent, and returns the job to the wait list', async () => {
      let ran = 0;
      const fake = register(async () => {
        ran += 1;
        return 'ok';
      });

      registryCache.__setEnabledForTesting([MODULE_ID], { deactivated: [MODULE_ID] });

      // BullMQ's own idiom for "not now, put it back": the worker rate-limits
      // itself and throws `RateLimitError`, which `moveLimitedBackToWait` turns
      // into `job.moveToWait(token)` — no `failed` event, no attempt consumed,
      // nothing dropped.
      await expect(fake.process()).rejects.toBeInstanceOf(RateLimitError);
      expect(ran, 'a deactivated module`s processor ran').toBe(0);
      expect(fake.rateLimitedForMs(), 'the worker did not back off').toBeGreaterThan(0);
    });

    it('decides presence before the work, so an unloaded cache is absent rather than a throw', async () => {
      let ran = 0;
      const fake = register(async () => {
        ran += 1;
        return 'ok';
      });

      // "Nothing has read the database" is neither axis's answer, and a
      // processor has nowhere to throw it to: the job is returned to the wait
      // list, exactly as for a module that is switched off.
      registryCache.__resetForTesting();

      await expect(fake.process()).rejects.toBeInstanceOf(RateLimitError);
      expect(ran).toBe(0);
    });
  });

  it('refuses a worker whose processor it cannot find, rather than registering an ungated one', () => {
    const processorless = { name: 'q', pause: async () => {}, resume: () => {}, isPaused: () => false, on: () => undefined };
    expect(() => defineModuleWorker(MODULE_ID, processorless as never)).toThrow(/processor could not be found/);
  });
});
