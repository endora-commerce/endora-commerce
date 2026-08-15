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
  // Feature 073, Amendment A1 (Constitution XVII). The ground is the
  // `_`-prefix infrastructure rule, not the specification's criterion set and
  // not "it owns the screen that switches modules on and off" — that argument
  // was circular, and D-36 removed its premise by moving the activation surface
  // to `/platform/modules`, which belongs to no module. An `_`-prefixed id is
  // platform-internal, and `assertActivationRules`
  // (`packages/contracts/src/modules.ts`) refuses any other activation form for
  // one. The route exemption (`ctx.ungatedRoutes`, T125) is a separate
  // mechanism and is not what this declaration rests on.
  activation: {
    nonDeactivatable: true,
    reason:
      'Platform-internal by the `_`-prefix rule the manifest schema enforces; it is the ' +
      'subsystem that resolves every other module\'s presence.',
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
