import { defineModuleManifest } from '@b2b/contracts';

/**
 * Megamenu module — feature 015.
 *
 * Owns the megamenu (multi-column dropdown navigation) configuration.
 * Manifest backfilled alongside feature 020.
 */
export const manifest = defineModuleManifest({
  id: 'megamenu',
  name: 'Megamenu',
  description: 'Multi-column dropdown navigation builder.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by — feature
  // 072 made it required rather than defaulting to a permissive no-op.
  // `dictionaries` owns the validator the menu service checks languages with.
  // `assets_library` owns the reference registry this module contributes its
  // asset-and-icon scan to (T143a); `cms` owns the one it contributes the
  // page/block scan to. Both edges existed as composition-root
  // cross-registrations, which is to say nowhere an operator could see them.
  dependencies: ['assets_library', 'cms', 'sales_channels', 'auth', 'dictionaries'],
  settings: {
    moduleCode: 'megamenu',
    groups: [{ code: 'megamenu', name: 'Megamenu' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'megamenu.enabled',
        name: 'Megamenu enabled',
        description:
          'Switches the megamenu admin screens, their API and the storefront navigation they drive on or off. Nothing is dropped: menus, items and channel bindings stay in the database and reappear exactly as configured when you switch it back on.',
        groupCode: 'megamenu',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'megamenu.read', label: 'View megamenu configuration' },
    { code: 'megamenu.write', label: 'Edit megamenu configuration' },
  ],
  actions: [
    {
      id: 'edit-megamenu',
      labelKey: 'actions.editMegamenu.label',
      descriptionKey: 'actions.editMegamenu.description',
      icon: 'Menu',
      targetRoute: '/megamenu',
      requiredPermission: 'megamenu.write',
      keywords: ['menu', 'edit', 'navigation', 'edytuj', 'nawigacja'],
      weight: 240,
    },
  ],
  // Feature 073 — the operator's activation control. Platform-wide. A platform
  // without a megamenu is a smaller platform, not a broken one: the menus,
  // their items and their channel bindings stay in the database and reappear
  // exactly as configured when it is switched back on.
  activation: { settingCode: 'megamenu.enabled', default: true },
});
