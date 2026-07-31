import { describe, expect, it } from 'vitest';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { settingsManifest as settingsModuleManifest } from '../../../src/modules/settings/manifest.js';
import { collectRegisteredSettingsManifests } from '../../../src/modules/settings/services/registered-settings-manifests.js';

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
 */
describe('boot settings reconciliation', () => {
  const collected = collectRegisteredSettingsManifests();

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

  it('lists each module code exactly once', () => {
    const codes = collected.map((m) => m.moduleCode);
    expect(codes).toEqual([...new Set(codes)]);
  });
});
