import { defineModuleManifest } from '@b2b/contracts';

/**
 * Invoices module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'invoices',
  name: 'Invoices',
  description:
    'Invoice generation, listing, and admin browsing.',
  version: '1.0.0',
  dependencies: [],
});
