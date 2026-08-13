import { defineModuleManifest } from '@b2b/contracts';

/**
 * Admin UI i18n subsystem — feature 019.
 *
 * Platform-internal module (underscore-prefixed exemption per Constitution
 * Principle VI, alongside `auth` / `example` / `_lifecycle`). Owns the
 * `translation_bundles` table, the per-language merged-bundle resolver,
 * the read API consumed by the admin SPA at boot, and the `core`
 * namespace that holds admin-chrome strings (AppShell, navigation,
 * login, profile).
 *
 * Depends on `_lifecycle` because every module's bundle install / hard-
 * uninstall is driven by the lifecycle orchestrator's hook surface.
 */
export const manifest = defineModuleManifest({
  id: '_i18n',
  name: 'Admin UI i18n',
  description:
    "Per-user Admin UI language preference and module-scoped translation bundles. " +
    'English is the platform-wide fallback (FR-013 / FR-016).',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port every route here is gated by;
  // `admin_users` owns the service the preferred-language setter writes through.
  // Neither depends back on this module, so the graph stays acyclic.
  dependencies: ['_lifecycle', 'auth', 'admin_users'],
  i18n: { bundlesDir: 'i18n' },
  // Feature 072/073 (Constitution XVII). An `_`-prefixed id is platform-internal
  // by convention and the manifest schema makes that enforceable: it must
  // declare this form. It is also true on the merits — every admin screen reads
  // its bundles, so a deployment with it off renders raw i18n keys everywhere.
  activation: {
    nonDeactivatable: true,
    reason:
      'Serves the translation bundles every Admin UI screen reads at boot; ' +
      'switched off, the whole admin renders raw i18n keys.',
  },
});
