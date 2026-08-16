import { defineModuleManifest } from '@b2b/contracts';

/**
 * Bootstrap manifest for the lifecycle subsystem itself. Carries no
 * dependencies and no settings — every other module's manifest is
 * discovered relative to this sentinel entry.
 */
export const manifest = defineModuleManifest({
  id: '_lifecycle',
  name: 'Module Lifecycle',
  description:
    'Platform-internal subsystem that orchestrates install / uninstall / ' +
    'enable / disable / status across every domain module.',
  version: '1.0.0',
  dependencies: [],
  /**
   * The one edge this subsystem resolves and cannot declare (issue #90).
   *
   * Its two admin surfaces — the API-interceptor screen and the module presence
   * projection — are guarded by `auth`'s `requireAdmin` port, exactly as every
   * other admin surface is. `dependencies` is the wrong home for it: that array
   * drives the **install order**, and this is the sentinel manifest every other
   * module's installation is recorded against, so ordering it after `auth` (and
   * transitively `admin_roles`) would have those modules install before the
   * registry that records an installation exists. The read itself is safe on the
   * other axis — `auth` is `nonDeactivatable`, so the gate has no state in which
   * it closes — and it stayed invisible until `check-port-dependencies` learned
   * to follow a module-local cradle alias.
   */
  acknowledgedDependencies: [
    {
      moduleId: 'auth',
      port: 'requireAdmin',
      reason:
        'The lifecycle admin surfaces are guarded by requireAdmin like every other admin ' +
        'surface, but this is the sentinel manifest the install order starts from: declaring ' +
        'auth would install it, and admin_roles, before the registry that records an ' +
        'installation. auth is non-deactivatable, so the gate never closes.',
    },
  ],
  // Feature 074 (Constitution XVII), test C1 — reachability. The ground is the
  // presence machinery itself: this module resolves every other module's two
  // axes, owns the orchestrator that flips them and the Command the activation
  // endpoint runs, so switched off there is no way back on for anything,
  // including itself. That is a statement about what this module *is*, not
  // about the screen it once hosted — D-36 moved the activation surface to
  // `/platform/modules`, which belongs to no module, and the old circular
  // argument went with it. The `_`-prefix rule is the structural second
  // ground: `assertActivationRules` (`packages/contracts/src/modules.ts`)
  // refuses any other activation form for a platform-internal id. The route
  // exemption (`ctx.ungatedRoutes`, T125) is a separate mechanism and is not
  // what this declaration rests on.
  activation: {
    nonDeactivatable: true,
    reason:
      'Owns the presence machinery and the activation switches themselves; switched off, ' +
      'there is no way back on.',
  },
  i18n: { bundlesDir: 'i18n' },
  /**
   * Principle XVI. The screen that says what this deployment offers and what
   * the business has switched on is reachable from ⌘K, not only from a nav
   * entry buried under System — it is the surface an operator goes looking for
   * precisely when something is missing and they cannot find the sidebar item
   * for it, because the module owning it is off.
   *
   * One action, deliberately: the write is a per-module flip with no route of
   * its own, so a palette entry per module would be a route dump.
   */
  actions: [
    {
      id: 'open-platform-modules',
      labelKey: 'actions.openPlatformModules.label',
      descriptionKey: 'actions.openPlatformModules.description',
      icon: 'Boxes',
      targetRoute: '/platform/modules',
      requiredPermission: 'platform.modules.read',
      keywords: ['modules', 'moduły', 'włącz', 'wyłącz', 'enable', 'disable', 'platform'],
      weight: 300,
    },
  ],
  permissions: [
    {
      code: 'platform.modules.read',
      module: 'module_lifecycle',
      label: 'View module lifecycle status',
    },
    {
      code: 'platform.modules.activate',
      module: 'module_lifecycle',
      label: 'Switch modules on and off',
    },
  ],
});
