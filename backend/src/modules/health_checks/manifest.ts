import { defineModuleManifest } from '@b2b/contracts';

/**
 * Health Checks module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'health_checks',
  name: 'Health Checks',
  description:
    'Liveness/readiness HTTP endpoints consumed by orchestrators.',
  version: '1.0.0',
  dependencies: [],
});
