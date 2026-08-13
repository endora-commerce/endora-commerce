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
  // `auth` owns the `requireAdmin` port; `admin_roles` owns the permission
  // service the palette filters entries with. Feature 072 made both container
  // resolutions rather than constructor arguments.
  dependencies: ['_i18n', '_lifecycle', 'auth', 'admin_roles'],
  i18n: { bundlesDir: 'i18n' },
  // Feature 073/072 (Constitution XVII). The command palette is how every
  // module's admin surface is discoverable (Principle XVI), and this module is
  // the registry behind it — switched off, ⌘K finds nothing anywhere, which is
  // not a smaller platform but one whose navigation has disappeared.
  activation: {
    nonDeactivatable: true,
    reason:
      'Holds the action registry behind the admin command palette; switched off, ' +
      'no module is discoverable under ⌘K anywhere in the admin.',
  },
});
