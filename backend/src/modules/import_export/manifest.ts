import { defineModuleManifest } from '@b2b/contracts';

/**
 * Import / Export module — bulk product import/export wizards.
 *
 * Manifest backfilled alongside feature 020 so the module can declare
 * command-palette actions. Same legacy-module note as catalog: the
 * underlying behaviour is foundational; hard-uninstall is intentionally
 * unsupported in this iteration.
 */
export const manifest = defineModuleManifest({
  id: 'import_export',
  name: 'Import / Export',
  description: 'Bulk product import and export wizard.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the routes are gated by; feature 072
  // made it a container resolution rather than a constructor argument.
  dependencies: ['catalog', 'auth'],
  settings: {
    moduleCode: 'import_export',
    groups: [{ code: 'import_export', name: 'Import / export' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'import_export.enabled',
        name: 'Import / export enabled',
        description:
          'Switches the CSV import and export endpoints on or off. The module holds no data of its own, so nothing is dropped — the catalog it reads and writes is untouched either way.',
        groupCode: 'import_export',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  i18n: { bundlesDir: 'i18n' },
  actions: [
    {
      id: 'import-products',
      labelKey: 'actions.importProducts.label',
      descriptionKey: 'actions.importProducts.description',
      icon: 'Upload',
      targetRoute: '/import-export',
      requiredPermission: 'catalog:write',
      keywords: ['import', 'csv', 'excel', 'upload', 'wgraj'],
      weight: 110,
    },
    {
      id: 'open-import-export-center',
      labelKey: 'actions.openCenter.label',
      descriptionKey: 'actions.openCenter.description',
      icon: 'FileUp',
      targetRoute: '/import-export',
      requiredPermission: 'catalog:write',
      keywords: ['import', 'export', 'center', 'centrum'],
      weight: 220,
    },
  ],
  activation: { settingCode: 'import_export.enabled', default: true },
});
