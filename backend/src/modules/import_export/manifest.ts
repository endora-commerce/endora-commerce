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
  dependencies: ['catalog'],
  i18n: { bundlesDir: 'i18n' },
  actions: [
    {
      id: 'import-products',
      labelKey: 'import_export.actions.importProducts.label',
      descriptionKey: 'import_export.actions.importProducts.description',
      icon: 'Upload',
      targetRoute: '/import-export',
      requiredPermission: 'catalog:write',
      keywords: ['import', 'csv', 'excel', 'upload', 'wgraj'],
      weight: 110,
    },
    {
      id: 'open-import-export-center',
      labelKey: 'import_export.actions.openCenter.label',
      descriptionKey: 'import_export.actions.openCenter.description',
      icon: 'FileUp',
      targetRoute: '/import-export',
      requiredPermission: 'catalog:write',
      keywords: ['import', 'export', 'center', 'centrum'],
      weight: 220,
    },
  ],
});
