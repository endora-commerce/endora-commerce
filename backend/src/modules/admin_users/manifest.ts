import { defineModuleManifest } from '@b2b/contracts';

/**
 * Admin Users module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'admin_users',
  name: 'Admin Users',
  description:
    'Admin user accounts, sessions, and impersonation flows.',
  version: '1.0.0',
  dependencies: ['admin_roles', 'auth'],
  // Feature 072/073 (Constitution XVII) — this module owns the admin login
  // route, the admin session and the impersonation flow. Switched off, nobody
  // can sign in to the Admin UI, including to switch it back on: the one
  // control that would undo the change is behind the door it just locked.
  activation: {
    nonDeactivatable: true,
    reason:
      'Owns admin login, sessions and impersonation; switched off, no operator could sign in ' +
      'to the Admin UI at all — including to switch it back on.',
  },
});
