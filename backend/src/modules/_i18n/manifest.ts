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
  // Feature 073, Amendment A1 (Constitution XVII). The ground is the
  // `_`-prefix infrastructure rule, not the specification's criterion set: an
  // `_`-prefixed id is platform-internal, and `assertActivationRules`
  // (`packages/contracts/src/modules.ts`) refuses any other activation form for
  // one. That is the rule this declaration follows; the merits — every admin
  // screen reads these bundles — agree with it but are not what carries it.
  activation: {
    nonDeactivatable: true,
    reason:
      'Platform-internal by the `_`-prefix rule the manifest schema enforces; it also serves ' +
      'the translation bundles every Admin UI screen reads.',
  },
});
