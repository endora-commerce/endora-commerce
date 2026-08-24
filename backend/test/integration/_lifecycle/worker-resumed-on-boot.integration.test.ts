import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defineModuleWorker,
  resumeWorkersFor,
  resetModuleWorkersForTesting,
} from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { makeFakeModuleWorker } from '../../helpers/fake-module-worker.js';

/**
 * Historical: a module wired into the composition *before* the lifecycle plugin
 * warmed the enabled-set cache (e.g. `catalog`, which owns the
 * `catalog.bulk-operation` / `search_reindex` worker) read as disabled at
 * `defineModuleWorker` time, so its worker started paused. The orchestrator only
 * resumes workers on an explicit enable transition — so without a boot-time
 * resume the worker stayed paused for the whole process lifetime and its queue
 * never drained (operations stuck on `pending`).
 *
 * **The resume loop this file was written for no longer exists** (feature 072,
 * D-38; feature 073, Amendment A2-Q2). It iterated `enabledIds()`, the platform
 * axis alone, and therefore also resumed the workers of a module the operator
 * had *deactivated*. It was deleted rather than corrected, because presence is
 * now loaded before the first module registers and each pause decision is right
 * when it is taken. The `it` below drives the loop inline; nothing in production
 * does. The fresh-boot property that replaced it is asserted in
 * `worker-presence-at-boot.integration.test.ts`.
 *
 * What still holds here, and why the file stays: the registration-order hazard
 * with an in-memory worker stub, and that `resumeWorkersFor` un-pauses a worker
 * paused at registration.
 */

describe('defineModuleWorker — resumed at boot when registered before cache warm (integration)', () => {
  const fake = makeFakeModuleWorker();

  beforeAll(() => {
    resetModuleWorkersForTesting();
    // Cache not yet warmed → module reads as disabled at registration time,
    // exactly as when `catalog` registers before the lifecycle plugin runs.
    registryCache.__setEnabledForTesting([]);
    defineModuleWorker('fixture_boot_resume', fake.worker);
  });

  afterAll(() => {
    resetModuleWorkersForTesting();
    registryCache.__setEnabledForTesting([]);
  });

  it('worker starts paused when its module reads disabled at registration', () => {
    expect(fake.state.paused).toBe(true);
  });

  it('warming the cache un-pauses it on its own — the presence install is the seam', async () => {
    // Lifecycle plugin warms the cache (module is in fact installed/enabled).
    // Since the Principle XVII worker repair, that install *is* what reconciles
    // the worker: no loop over `enabledIds()`, which is why the one D-38 deleted
    // is not missed. The pause decision and the resume decision are now the same
    // decision, taken from the same value, in whichever process holds the worker.
    registryCache.__setEnabledForTesting(['fixture_boot_resume']);
    await Promise.resolve();
    expect(fake.state.paused).toBe(false);
  });

  it('resumeWorkersFor still un-pauses a worker paused by hand', async () => {
    // The orchestrator's imperative half, which survives as an optimisation: it
    // makes the local process's answer immediate instead of one refresh away.
    await fake.worker.pause();
    expect(fake.state.paused).toBe(true);

    await resumeWorkersFor('fixture_boot_resume');
    expect(fake.state.paused).toBe(false);
  });
});
