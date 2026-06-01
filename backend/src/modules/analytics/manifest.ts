import { defineModuleManifest } from '@b2b/contracts';

/**
 * Analytics module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'analytics',
  name: 'Analytics',
  description:
    'Server-side analytics aggregation and dashboard data feeds.',
  version: '1.0.0',
  dependencies: [],
  permissions: [{ code: 'analytics:read', label: 'View analytics dashboards' }],
});
