import { defineModuleManifest } from '@b2b/contracts';

/**
 * Admin Roles module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'admin_roles',
  name: 'Admin Roles',
  description:
    'Admin RBAC — roles, permissions, and policy enforcement for admin sessions.',
  version: '1.0.0',
  dependencies: [],
});
