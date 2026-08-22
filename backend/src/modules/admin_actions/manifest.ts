import type { EntityManager } from '@mikro-orm/postgresql';
import { defineModuleManifest, type ModuleLifecycleParticipant } from '@endora-commerce/contracts';

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

/**
 * `module_actions` follows the manifest set — feature 080, T036a / D-159.
 *
 * `_i18n/manifest.ts` states the shape's reasoning in full; this module is the
 * second instance of it, projecting every other module's `manifest.actions`
 * array instead of its `i18n` block.
 *
 * **It is not gated on this module's own activation, and that is a ruling**
 * (D-159 §9, the owner, 2026-08-22). `composition.ts` used to forward the
 * reconciler as a lazily-resolved port, so an operator who had switched the
 * command palette off could not install an *unrelated* module — the install
 * aborted on a `MODULE_DISABLED` from a discovery surface that has nothing to
 * do with it. That was the better of the only two options then on the table,
 * the other being a backend that would not start; the third, which this takes,
 * is that a projection of manifest data is written whether or not anything is
 * serving it. The rows are inert while the palette is off and the palette
 * answers from them, unchanged, the moment it is switched back on.
 */
export const lifecycleParticipant: ModuleLifecycleParticipant<EntityManager> = {
  async onModuleInstalled({ moduleId, manifest: installed, em }) {
    const { AdminActionsReconciler } = await import(
      './services/admin-actions-reconciler.js'
    );
    await new AdminActionsReconciler({ em: () => em }).installForModule({
      moduleId,
      // Unconditional, including for the empty array: `installForModule`
      // upserts *and prunes*, so a module that has dropped its last action
      // needs the call in order for its last row to go.
      actions: installed.actions ?? [],
      em,
    });
  },
  async onModuleHardUninstalled({ moduleId, em }) {
    const { AdminActionsReconciler } = await import(
      './services/admin-actions-reconciler.js'
    );
    await new AdminActionsReconciler({ em: () => em }).removeForModule({ moduleId, em });
  },
};
