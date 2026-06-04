import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defineModuleWorker,
  resumeWorkersFor,
} from '../../../src/modules/_lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';

/**
 * Regression: a module wired into the composition *before* the lifecycle
 * plugin warms the enabled-set cache (e.g. `catalog`, which owns the
 * `catalog.bulk-operation` / `search_reindex` worker) reads as disabled at
 * `defineModuleWorker` time, so the worker starts paused. The orchestrator
 * only resumes workers on an explicit enable transition — so without an
 * explicit boot-time resume the worker stays paused for the whole process
 * lifetime and its queue never drains (operations stuck on `pending`).
 *
 * The fix resumes every enabled module's workers right after the cache is
 * warmed. This test reproduces the order-of-registration hazard with an
 * in-memory worker stub.
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

  it('boot-time resume of enabled modules un-pauses the worker', async () => {
    // Lifecycle plugin warms the cache (module is in fact installed/enabled)…
    registryCache.__setEnabledForTesting(['fixture_boot_resume']);
    // …then resumes workers for every enabled module (the fix).
    for (const moduleId of registryCache.enabledIds()) {
      await resumeWorkersFor(moduleId);
    }
    expect(paused).toBe(false);
  });
});
