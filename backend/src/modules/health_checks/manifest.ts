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
  // Feature 072 (T080) / Constitution XVII — converting this module put
  // `/api/v1/_health` behind `defineModuleRoutes`, which the inline plugin in
  // `composition.ts` was not. The operator axis is therefore declared closed:
  // a container whose liveness probe answers 503 is restarted by its
  // orchestrator, so "switched off" would read as "permanently unhealthy".
  activation: {
    nonDeactivatable: true,
    reason:
      'Orchestrators use the liveness endpoint to decide whether this container ' +
      'is healthy; without it the deployment restarts in a loop.',
  },
});
