import { settingsManifestWithRecentActivity } from '@endora-commerce/contracts';
import type {
  ModuleManifest,
  ModuleRecentActivity,
  ModuleSettingsManifest,
} from '@endora-commerce/contracts';
import { settingsManifest as settingsModuleManifest } from '../manifest.js';

/** The two properties of a registry entry this derivation reads. */
export interface SettingsManifestSource {
  readonly manifest: ModuleManifest;
  /**
   * The module's recent-activity eligibility (feature 080, T042j / D-163.1).
   * It implies one Setting — the operator's choice of whether this module's
   * entries reach the dashboard card — which is derived rather than declared,
   * so a module that adds the eligibility export gets the control with it.
   */
  readonly recentActivity?: ModuleRecentActivity | undefined;
}

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
 * Deriving from the registry makes registration the single act that wires a
 * module in, matching how permissions, i18n bundles, and command-palette
 * actions already work.
 *
 * **The registry arrives as an argument (feature 075, Phase C).** It used to be
 * imported from `_lifecycle`, which made `settings` name another module's file
 * for a fact it does not own: which modules a deployment ships — core plus that
 * deployment's overlay modules — is a composition-root input by nature, and it
 * is why `resolvedModuleRegistry` is a platform-owned container name rather
 * than a port. Both roots call this function and both already hold the
 * registry, so the caller passes what it already has. Nothing is gated here on
 * purpose: a module that is switched off keeps its settings rows and keeps its
 * group on `/settings`, because a deactivation is not an uninstall
 * (Constitution XVII) and the operator has to be able to switch it back on.
 */
export function collectRegisteredSettingsManifests(
  registry: ReadonlyArray<SettingsManifestSource>,
): ModuleSettingsManifest[] {
  // The settings module goes first: every other manifest's settings fall back
  // to its `general` group, which must exist before they are inserted.
  const rest = registry
    .map((entry) => settingsManifestWithRecentActivity(entry.manifest, entry.recentActivity))
    .filter(
      (manifest): manifest is ModuleSettingsManifest =>
        manifest !== undefined && manifest.moduleCode !== settingsModuleManifest.moduleCode,
    );
  return [settingsModuleManifest, ...rest];
}
