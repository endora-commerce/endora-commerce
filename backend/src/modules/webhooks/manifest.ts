import { defineModuleManifest } from '@b2b/contracts';

/**
 * Webhooks module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'webhooks',
  name: 'Webhooks',
  description:
    'Outbound webhook subscription registry and dispatcher.',
  version: '1.0.0',
  dependencies: ['organizations'],
});
