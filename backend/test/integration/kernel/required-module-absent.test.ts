import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * A composition that lacks a required module refuses to start, and says which
 * one (issue #258).
 *
 * `deactivated-boot.test.ts` is this file's mirror image: it proves the backend
 * still starts with a *switchable* module absent, because switching one off is
 * a supported operator action and must not stop the next start. This proves the
 * opposite for the modules an operator is not offered — the ones whose manifest
 * declares `activation.nonDeactivatable`. Their absence is not a smaller
 * platform, it is a broken one, and the person who has to hear about it is
 * whoever assembled the deployment.
 *
 * **The hazard it closes.** `invoices` grandfathers its numbering pattern from a
 * `ctx.onBoot` hook (feature 078, D-95.3) and the write goes through `settings`'
 * port. `NumberingConfigurationService` re-throws `ModuleDisabledError`
 * deliberately — the write is the whole point of the hook — `runBootHooks`
 * attributes the failure to `invoices`, and `index.ts` turns that into
 * `process.exit(1)`. So a platform whose `settings` is absent did not degrade,
 * it exited, and the sentence it exited with named the wrong module and no
 * remedy:
 *
 *     ModuleCompositionError: [kernel] module 'invoices' failed in its boot
 *     hook: MODULE_DISABLED
 *
 * It had never been seen because on any database where the platform booted once
 * the grandfather write has already happened and the hook finds nothing to do.
 * Only a genuinely first boot reaches the port — which is why the assertions
 * below do not depend on the database being fresh: the refusal now fires before
 * the first boot hook runs, so it fires whatever the settings rows say.
 *
 * The two negative assertions are the regression, not decoration. A message
 * naming `invoices` is the defect this closes; a message naming `settings` with
 * a remedy is the repair.
 */

const ALL_MODULE_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);

/**
 * `settings` withdrawn on the **platform** axis, which is the only axis that can
 * express it: `effectiveState` forces a non-deactivatable module's operator axis
 * on whatever a Setting says, so seeding it as deactivated would simulate a
 * state no operator and no CLI can reach.
 *
 * Applied after the real `loadModulePresence` for the same reason
 * `deactivated-boot.test.ts` does it: presence is loaded from PostgreSQL before
 * the first module registers, so a state seeded earlier would simply be
 * overwritten.
 */
vi.mock('../../../src/lifecycle/services/presence-load.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/lifecycle/services/presence-load.js')>();
  return {
    ...actual,
    loadModulePresence: async (
      opts: Parameters<typeof actual.loadModulePresence>[0],
    ): Promise<void> => {
      await actual.loadModulePresence(opts);
      const { registryCache: cache } = await import(
        '../../../src/kernel/lifecycle/registry-cache.js'
      );
      cache.__setEnabledForTesting(ALL_MODULE_IDS.filter((id) => id !== 'settings'));
    },
  };
});

describe('the production composition root refuses to start without a required module', () => {
  let compositionError: unknown;
  const originalRole = process.env['BACKEND_ROLE'];

  beforeAll(async () => {
    const url = process.env['DATABASE_URL'];
    expect(url, 'DATABASE_URL must be set by test/global-setup.ts').toBeTruthy();
    expect(new URL(url as string).pathname.replace(/^\//, '')).toMatch(/(^|_)test(_|$)/);

    process.env['BACKEND_ROLE'] = 'api';

    const { composeApp } = await import('../../../src/composition.js');
    try {
      const composition = await composeApp();
      // Nothing should reach here; dispose anyway so a failure of this file
      // does not leak a pool into every file after it.
      await composition.dispose();
    } catch (err) {
      compositionError = err;
    }
  });

  afterAll(() => {
    registryCache.stopFallbackRefresh();
    registryCache.__setEnabledForTesting(ALL_MODULE_IDS);
    if (originalRole === undefined) delete process.env['BACKEND_ROLE'];
    else process.env['BACKEND_ROLE'] = originalRole;
  });

  it('refuses the composition instead of starting', () => {
    expect(compositionError).toBeDefined();
  });

  it('refuses it as a missing required module, not as somebody else failing', () => {
    expect((compositionError as Error | undefined)?.name).toBe('RequiredModuleAbsentError');
  });

  it('names the absent module and the sentence its own manifest gives for the lock', () => {
    const message = (compositionError as Error | undefined)?.message ?? '';
    expect(message).toContain('settings');
    expect(message).toContain('The configuration surface for every other module');
  });

  it('names a remedy the operator can act on', () => {
    const message = (compositionError as Error | undefined)?.message ?? '';
    expect(message).toContain('module:enable settings');
  });

  it('does not name `invoices`, whose boot hook used to be the visible failure', () => {
    const message = (compositionError as Error | undefined)?.message ?? '';
    expect(message).not.toContain('invoices');
    expect(message).not.toContain('failed in its boot hook');
  });
});
