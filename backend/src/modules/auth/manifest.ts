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
  // Feature 072, D-32 — `auth` owns the one `requireAdmin` implementation, and
  // that guard checks a permission through `admin_roles`' PermissionService.
  // The edge existed in the code long before it existed in the manifest; it is
  // one of the 261 imported-but-undeclared dependencies F3 will finish fixing.
  dependencies: ['admin_roles'],
});
