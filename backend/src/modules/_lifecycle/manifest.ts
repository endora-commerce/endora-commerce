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
  // Feature 072/073 (Constitution XVII) — the surface that switches modules on
  // and off cannot be switched off. Its routes are registered through
  // `ctx.ungatedRoutes` for the same reason (T125), so this declaration is the
  // platform axis catching what the route exemption already covers on the
  // operator one: an operator reaches /platform/modules precisely when
  // something is missing, and the one module that must answer then is this one.
  activation: {
    nonDeactivatable: true,
    reason:
      'Serves the module presence projection and the activation write — the surface an ' +
      'operator uses to switch anything back on, including this.',
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
