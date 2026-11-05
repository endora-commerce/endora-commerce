import { defineModuleManifest } from '@endora-commerce/contracts';

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
  name: 'Import / export',
  description: 'Bulk product import and export wizard.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the routes are gated by; feature 072
  // made it a container resolution rather than a constructor argument. It is
  // the only **binding** dependency: every route is admin-gated, so an
  // import/export centre without `auth` is a centre with no door.
  //
  // `catalog` left this list in D-74, and the direction is the point. It used
  // to be here while `inventory` — whose `stock_levels` this module wrote —
  // was not, an edge no check in the tree could see. Both are declared now,
  // and neither binds: an operator must be able to switch `orders` off without
  // being told an import module forbids it.
  dependencies: ['auth'],
  /**
   * D-74 — the five owners whose rows this module reads and writes, declared as
   * real container edges that bind no operator.
   *
   * `degrades-without` obliges the module to **check presence before it reads**,
   * and it does: the adapter table carries the owning module ids per entity and
   * the supported-entity list is filtered by `effectiveState.isPresent`, so a
   * switched-off owner removes one entity from
   * `GET /api/v1/admin/import-export/entities` and makes a POST naming it the
   * same 404 an unknown slug gets. That is what makes these declarations true
   * rather than decorative — before it, the five slugs were a literal array in
   * the admin SPA.
   */
  nonBindingDependencies: [
    {
      moduleId: 'catalog',
      name: 'catalogProductReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'The import/export centre stops offering the Products and Stock entities; every other entity is unaffected.',
      reason:
        'The products export reads the catalogue through `catalog`\'s published read port. An operator switching the catalogue off should lose the products sheet, not the orders and customers sheets beside it.',
    },
    {
      moduleId: 'catalog',
      name: 'catalogCategoryReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'The import/export centre stops offering the Categories entity; every other entity is unaffected.',
      reason:
        'The categories export reads the tree through `catalog`\'s published read port; the entity is withdrawn from the offered list rather than answering 503.',
    },
    {
      moduleId: 'catalog',
      name: 'catalogBulkImportPort',
      kind: 'degrades-without',
      whenAbsent:
        'The import/export centre stops offering the Products and Categories imports; every other entity is unaffected.',
      reason:
        'A catalogue import is `catalog`\'s transaction and `catalog`\'s audit row (D-74). With the module off the entity is not offered, so the operator never reaches the gate.',
    },
    {
      moduleId: 'catalog',
      name: 'catalogAttributeReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'The import/export centre stops offering the Products import; every other entity is unaffected.',
      reason:
        'Feature 174 — a products header names attributes (`attribute:<key>`); their value type and scope set decide how a cell reads and where it may be written.',
    },
    {
      moduleId: 'catalog',
      name: 'catalogProductAvailabilityPort',
      kind: 'degrades-without',
      whenAbsent:
        'The import/export centre stops offering the Products import; every other entity is unaffected.',
      reason:
        'Feature 174 (FR-042) — a mapped locale column writes only the channels a product belongs to; membership is `catalog`\'s answer, so a target the product is not in is reported for that row.',
    },
    {
      moduleId: 'inventory',
      name: 'inventoryStockReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'The import/export centre stops offering the Stock entity; every other entity is unaffected.',
      reason:
        'The stock export joins `inventory`\'s levels onto `catalog`\'s SKUs. This module wrote `stock_levels` for a year without declaring the edge at all; declaring it non-bindingly is what keeps the centre usable while stock management is off.',
    },
    {
      moduleId: 'inventory',
      name: 'inventoryStockImportPort',
      kind: 'degrades-without',
      whenAbsent:
        'The import/export centre stops offering the Stock import; every other entity is unaffected.',
      reason:
        'A stock import is `inventory`\'s transaction and `inventory`\'s audit row (D-74), including the seeded warehouse this module used to name by a copied UUID.',
    },
    {
      moduleId: 'orders',
      name: 'orderReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'The import/export centre stops offering the Orders export; every other entity is unaffected.',
      reason:
        'Export only — orders are produced by the checkout flow. `OrderReadPort.listAll` was published by Phase P with "for the bulk export adapter" in its own doc comment; this is that adapter.',
    },
    {
      moduleId: 'customer_accounts',
      name: 'customerAccountReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'The import/export centre stops offering the Customers export; every other entity is unaffected.',
      reason:
        'Export only — provisioning accounts needs a password story a CSV upload has no place for. `CustomerAccountReadPort.listAll` was published for this adapter by name.',
    },
    {
      moduleId: 'organizations',
      name: 'organizationDetailsPort',
      kind: 'degrades-without',
      whenAbsent:
        'The import/export centre stops offering the Customers export; every other entity is unaffected.',
      reason:
        'The customers sheet names each account\'s organisation, so that one entity needs both owners present. No other entity reads this port.',
    },
    {
      moduleId: 'organizations',
      name: 'organizationRoleReadPort',
      kind: 'degrades-without',
      whenAbsent:
        'The import/export centre stops offering the Customers export; every other entity is unaffected.',
      reason:
        'The customers sheet names the role each account holds, its name and kind (`specs/170-organization-roles/`), and roles are `organizations`\' rows. Read only by that one entity, which is offered only while `organizations` is present.',
    },
  ],
  settings: {
    moduleCode: 'import_export',
    groups: [{ code: 'import_export', name: 'Import / export' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'import_export.enabled',
        name: 'Import / export enabled',
        description:
          'Switches the CSV import and export endpoints on or off. Nothing is dropped: the import profiles are kept while it is off and come back when it is switched on again, and the catalog it reads and writes is untouched either way.',
        groupCode: 'import_export',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  /** Feature 174 (`contracts/error-codes.md`) — the import profile refusals this module mints. */
  errorCodes: [
    { code: 'IMPORT_PROFILE_NAME_TAKEN' },
    { code: 'IMPORT_PROFILE_NOT_FOUND' },
    { code: 'IMPORT_PROFILE_REQUIRED' },
  ],
  actions: [
    {
      id: 'import-products',
      labelKey: 'actions.importProducts.label',
      descriptionKey: 'actions.importProducts.description',
      icon: 'Upload',
      targetRoute: '/import-export',
      requiredPermission: 'catalog:write',
      keywords: ['import', 'csv', 'excel', 'upload'],
      keywordsKey: 'actions.importProducts.keywords',
      weight: 110,
    },
    {
      id: 'open-import-export-center',
      labelKey: 'actions.openCenter.label',
      descriptionKey: 'actions.openCenter.description',
      icon: 'FileUp',
      targetRoute: '/import-export',
      requiredPermission: 'catalog:write',
      // Feature 174 — the Import profiles section lives on this screen (no route of its own).
      keywords: ['import', 'export', 'center', 'profile', 'mapping'],
      keywordsKey: 'actions.openCenter.keywords',
      weight: 220,
    },
  ],
  activation: { settingCode: 'import_export.enabled', default: true },
});
