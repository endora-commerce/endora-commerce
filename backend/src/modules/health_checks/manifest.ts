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
  // outright, through `ctx.ungatedRoutes`: there is no seam left for either
  // axis to close, so an orchestrator that reports this module disabled still
  // answers /health.
  //
  // What the flag would add is therefore nothing. It binds **both** axes since
  // `assertDeactivatable` shipped — the platform CLI refuses the disable with no
  // `--force`, exactly as the operator write does (feature 073, Amendment A1;
  // this comment previously claimed it closed the operator axis only, which was
  // true before that method existed and false after). Declaring it here would
  // announce a hazard the route exemption has already removed, and a declaration
  // about a hazard is what D-32 rejected in favour of a structure without one.
});
