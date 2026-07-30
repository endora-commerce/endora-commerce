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
  dependencies: ['cms', 'sales_channels'],
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
});
