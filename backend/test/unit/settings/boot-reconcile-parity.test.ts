import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { settingsManifest as settingsModuleManifest } from '../../../../packages/modules/settings/src/manifest.js';
import { collectRegisteredSettingsManifests } from '../../../../packages/modules/settings/src/backend/services/registered-settings-manifests.js';

/**
 * Regression guard — every module that declares a settings manifest must be
 * reconciled at boot.
 *
 * The boot list used to be a literal array in `composition.ts`, so a module
 * could declare `settings: defineModuleSettingsManifest(...)` and still be
 * forgotten there. Eight modules had drifted that way (`ksef`, `mfa`, `carts`,
 * `customers`, `orders`, `organizations`, `quick_order`, `returns`): their
 * `setting_groups` / `settings` rows were never created, `/settings` omitted the
 * whole group, and `GET /api/v1/admin/settings/<code>` answered 404. The test
 * harness kept its own, differently stale copy of the list, which is why the
 * suite saw settings that production never had.
 *
 * Feature 075, Phase C — the registry is now an **argument**. Which modules a
 * deployment ships is a composition-root input, not something `settings` may
 * decide for itself, so the module stopped reaching into `_lifecycle` for it
 * and the two roots pass the registry they already hold. The first two cases
 * below are the production wiring, exercised against the real registry; the
 * third is what the argument bought — the derivation can be checked against a
 * registry of the test's own making, which was impossible while it was read
 * from a module-level constant.
 */
describe('boot settings reconciliation', () => {
  const collected = collectRegisteredSettingsManifests(REGISTERED_MANIFESTS);

  it('covers every module that declares a settings manifest', () => {
    const declared = REGISTERED_MANIFESTS.filter((e) => e.manifest.settings).map(
      (e) => e.manifest.settings!.moduleCode,
    );
    expect(declared.length).toBeGreaterThan(0);

    const covered = new Set(collected.map((m) => m.moduleCode));
    const missing = declared.filter((code) => !covered.has(code));
    expect(
      missing,
      `These modules declare a settings manifest but would not be reconciled at ` +
        `boot, so their settings never appear on /settings: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('reconciles the settings module first so the `general` group exists', () => {
    // Settings that name no group fall back to `general`, which the settings
    // module owns — it has to be inserted before anything referencing it.
    expect(collected[0]?.moduleCode).toBe(settingsModuleManifest.moduleCode);
  });

  it('derives the list from the registry it is handed, not from a global one', () => {
    const probe = {
      manifest: {
        id: 'probe_module',
        name: 'Probe module',
        version: '1.0.0',
        dependencies: [],
        settings: {
          moduleCode: 'probe_module',
          groups: [],
          settings: [],
        },
      } as unknown as ModuleManifest,
    };

    const fromProbe = collectRegisteredSettingsManifests([probe]);

    expect(fromProbe.map((m) => m.moduleCode)).toEqual([
      settingsModuleManifest.moduleCode,
      'probe_module',
    ]);
  });

  it('lists each module code exactly once', () => {
    const codes = collected.map((m) => m.moduleCode);
    expect(codes).toEqual([...new Set(codes)]);
  });
});
