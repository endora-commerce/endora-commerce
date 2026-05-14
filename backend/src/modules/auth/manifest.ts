import { defineModuleManifest } from '@b2b/contracts';

/**
 * Auth module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'auth',
  name: 'Auth',
  description:
    'Authentication primitives — session cookies, bearer-token resolution, and request actor binding.',
  version: '1.0.0',
  dependencies: [],
});
