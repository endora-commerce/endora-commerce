import { defineModuleManifest } from '@b2b/contracts';

/**
 * API Keys module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'api_keys',
  name: 'API Keys',
  description:
    'Programmatic API keys (Bearer tokens) used by integrations and webhooks.',
  version: '1.0.0',
  dependencies: ['customer_accounts', 'organizations', 'sales_channels'],
});
