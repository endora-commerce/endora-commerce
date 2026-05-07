import { defineModuleManifest } from '@b2b/contracts';

/**
 * Admin Command Palette Actions Registry — feature 020.
 *
 * Owns the `module_actions` table, the install-time reconciler that
 * ingests every module's manifest `actions` array, the in-process
 * cache, and the read API consumed by the admin SPA's command palette.
 * Itself declares no actions — this module is platform plumbing, not
 * a place to surface UI features.
 *
 * Depends on `_lifecycle` because every module's action install / hard-
 * uninstall is driven by the lifecycle orchestrator's hook surface, and
 * on `_i18n` because action labels and descriptions are resolved
 * through the existing translation-bundle resolver.
 */
export const manifest = defineModuleManifest({
  id: 'admin_actions',
  name: 'Admin Command Palette Actions',
  description:
    'Module-contributed action registry that surfaces declared actions in the admin command palette.',
  version: '1.0.0',
  dependencies: ['_lifecycle', '_i18n'],
  i18n: { bundlesDir: 'i18n' },
});
