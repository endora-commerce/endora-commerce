import type { ModuleSettingsManifest } from '@b2b/contracts';
import { REGISTERED_MANIFESTS } from '../../_lifecycle/registered-manifests.js';
import { settingsManifest as settingsModuleManifest } from '../manifest.js';

/**
 * Every settings manifest the boot-time {@link ManifestReconciler} must walk,
 * derived from the module registry rather than hand-listed.
 *
 * This used to be a literal array in `composition.ts`, and a module could
 * declare `settings: defineModuleSettingsManifest(...)` in its manifest yet be
 * forgotten there. When that happened the module's `setting_groups` /
 * `settings` rows were never created, so `/settings` silently omitted the whole
 * group and `GET /api/v1/admin/settings/<code>` answered 404
 * `SETTING_NOT_REGISTERED`. Eight modules had drifted that way — `ksef`, `mfa`,
 * `carts`, `customers`, `orders`, `organizations`, `quick_order`, `returns` —
 * and nothing caught it, not least because the test harness kept its own
 * (differently stale) copy of the list.
 *
 * Deriving from `REGISTERED_MANIFESTS` makes registration the single act that
 * wires a module in, matching how permissions, i18n bundles, and command-palette
 * actions already work.
 */
export function collectRegisteredSettingsManifests(): ModuleSettingsManifest[] {
  // The settings module goes first: every other manifest's settings fall back
  // to its `general` group, which must exist before they are inserted.
  const rest = REGISTERED_MANIFESTS.map((entry) => entry.manifest.settings).filter(
    (manifest): manifest is ModuleSettingsManifest =>
      manifest !== undefined && manifest.moduleCode !== settingsModuleManifest.moduleCode,
  );
  return [settingsModuleManifest, ...rest];
}
