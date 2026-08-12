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
  // No activation declaration, deliberately (D-36a item 4). This module owns
  // exactly one surface — the probes — and D-36b exempts them from gating
  // outright, which is a stronger guarantee than `nonDeactivatable`: the flag
  // closes the operator axis only, while the platform axis (the lifecycle CLI)
  // would still take a gated route down. With nothing gated left to protect,
  // the flag would declare a hazard that no longer exists, and a declaration
  // about a hazard is exactly what D-32 rejected in favour of a structure
  // without one.
});
