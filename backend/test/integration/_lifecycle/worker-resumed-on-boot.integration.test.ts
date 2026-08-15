import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defineModuleWorker,
  resumeWorkersFor,
} from '../../../src/modules/_lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';

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
  let paused = false;

  const fakeWorker = {
    pause: async (): Promise<void> => {
      paused = true;
    },
    resume: async (): Promise<void> => {
      paused = false;
    },
  };

  beforeAll(() => {
    // Cache not yet warmed → module reads as disabled at registration time,
    // exactly as when `catalog` registers before the lifecycle plugin runs.
    registryCache.__setEnabledForTesting([]);
    defineModuleWorker('fixture_boot_resume', fakeWorker as never);
  });

  afterAll(() => {
    registryCache.__setEnabledForTesting([]);
  });

  it('worker starts paused when its module reads disabled at registration', () => {
    expect(paused).toBe(true);
  });

  it('resuming an enabled module un-pauses the worker (the deleted boot loop, driven by hand)', async () => {
    // Lifecycle plugin warms the cache (module is in fact installed/enabled)…
    registryCache.__setEnabledForTesting(['fixture_boot_resume']);
    // …then resumes workers for every enabled module. This is the loop D-38
    // deleted; it runs here, not in `_lifecycle`'s plugin.
    for (const moduleId of registryCache.enabledIds()) {
      await resumeWorkersFor(moduleId);
    }
    expect(paused).toBe(false);
  });
});
