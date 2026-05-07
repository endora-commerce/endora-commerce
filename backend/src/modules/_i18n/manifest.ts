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
  dependencies: ['_lifecycle'],
  i18n: { bundlesDir: 'i18n' },
});
