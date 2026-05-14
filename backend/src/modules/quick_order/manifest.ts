import { defineModuleManifest } from '@b2b/contracts';

/**
 * Quick Order module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'quick_order',
  name: 'Quick Order',
  description:
    'Bulk add-to-cart from SKU lists / CSV upload.',
  version: '1.0.0',
  dependencies: [],
});
