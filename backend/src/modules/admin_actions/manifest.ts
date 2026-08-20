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
  settings: {
    moduleCode: 'admin_actions',
    groups: [{ code: 'admin_actions', name: 'Command palette' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'admin_actions.enabled',
        name: 'Command palette enabled',
        description:
          'Switches the admin command palette on or off: the action registry every module contributes to and the read API behind ⌘K. Switched off, the admin is navigated through the sidebar alone; nothing is dropped — the registered actions stay in the database and the palette answers again exactly as before when you switch it back on.',
        groupCode: 'admin_actions',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  // Feature 073, Amendment A1 (Constitution XVII) — deactivatable. What this
  // module gates is *discoverability*: with it off the sidebar still navigates
  // the whole admin, so losing ⌘K is a degradation rather than the loss of a
  // capability. It is also the only module in the declaring set with no external
  // manifest dependent at all — nothing fails closed behind it — so the flag was
  // protecting a convenience, which is not what `nonDeactivatable` is for.
  activation: { settingCode: 'admin_actions.enabled', default: true },
});
