/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * Listed in ascending timestamp, which orders **this module's own** migrations
 * and nothing else (feature 081). Where this block sits relative to every other
 * module's is decided by the manifest `dependencies` graph. The entries stamped
 * at or below `BASELINE_THROUGH` sit in the frozen historical prefix, where the
 * order is history; the ones above it are placed by the graph like any other.
 * **How many of each is not written here** — the stamps answer it, and the
 * counts that stood in this sentence were stale the first time a migration was
 * added under them (D-100).
 *
 * The **named** exports stay, and the asymmetry with `./backend` — which
 * publishes an array and no entity class by name (D-168) — is deliberate.
 * `db/migrations-registry.generated.ts` imports each class by name from this
 * specifier, and a migration class name is contract in a way an entity class
 * name is not: `mikro_orm_migrations` persists it, so it is a string every
 * already-migrated database holds.
 *
 * A class that is in neither the array nor the barrel is a migration that does
 * not run: `migration:pending` reports nothing pending and the first symptom
 * is a query against a table nobody created.
 */

import { Migration20260429T064146CatalogAttributeSetsInit } from './20260429T064146_catalog_attribute_sets_init.js';
import { Migration20260429T070004CatalogProductAttributeExtensions } from './20260429T070004_catalog_product_attribute_extensions.js';
import { Migration20260429T102322CatalogProductTypeAndVirtualFields } from './20260429T102322_catalog_product_type_and_virtual_fields.js';
import { Migration20260429T111839CatalogGalleryItemsAndLabels } from './20260429T111839_catalog_gallery_items_and_labels.js';
import { Migration20260429T112543CatalogProductAttachments } from './20260429T112543_catalog_product_attachments.js';
import { Migration20260429T123726CatalogProductLinks } from './20260429T123726_catalog_product_links.js';
import { Migration20260429T130803CatalogGroupedAndBundle } from './20260429T130803_catalog_grouped_and_bundle.js';
import { Migration20260501T185835CatalogProductAttributeIsComparable } from './20260501T185835_catalog_product_attribute_is_comparable.js';
import { Migration20260505T060113CatalogAttributeOptionsAndFlags } from './20260505T060113_catalog_attribute_options_and_flags.js';
import { Migration20260515T082629CatalogAttributeMassEditable } from './20260515T082629_catalog_attribute_mass_editable.js';
import { Migration20260526T124736CatalogProductStatusInactive } from './20260526T124736_catalog_product_status_inactive.js';
import { Migration20260611T140346CatalogProductValueOverridesInit } from './20260611T140346_catalog_product_value_overrides_init.js';
import { Migration20260611T140400CatalogAttributeQuickSearchable } from './20260611T140400_catalog_attribute_quick_searchable.js';
import { Migration20260611T140407CatalogBulkOperations } from './20260611T140407_catalog_bulk_operations.js';
import { Migration20260611T140408CatalogBulkOperationLogs } from './20260611T140408_catalog_bulk_operation_logs.js';
import { Migration20260611T140412CatalogProductPackagingUnits } from './20260611T140412_catalog_product_packaging_units.js';
import { Migration20260718T060659CatalogBulkOperationRevertState } from './20260718T060659_catalog_bulk_operation_revert_state.js';
import { Migration20260718T200343CatalogCategoryCustomFieldValues } from './20260718T200343_catalog_category_custom_field_values.js';
import { Migration20260723T230401CatalogAttributesOnCustomFields } from './20260723T230401_catalog_attributes_on_custom_fields.js';
import { Migration20260804T152604CatalogWidenProductSku } from './20260804T152604_catalog_widen_product_sku.js';
import { Migration20260804T160244CatalogCategoryActivation } from './20260804T160244_catalog_category_activation.js';
import { Migration20260912T094557CatalogSalesChannelProducts } from './20260912T094557_catalog_sales_channel_products.js';
import { Migration20260912T094623CatalogSalesChannelCategories } from './20260912T094623_catalog_sales_channel_categories.js';
import { Migration20260925T125527CatalogInventoryColumns } from './20260925T125527_catalog_inventory_columns.js';

export const migrations = [
  Migration20260429T064146CatalogAttributeSetsInit,
  Migration20260429T070004CatalogProductAttributeExtensions,
  Migration20260429T102322CatalogProductTypeAndVirtualFields,
  Migration20260429T111839CatalogGalleryItemsAndLabels,
  Migration20260429T112543CatalogProductAttachments,
  Migration20260429T123726CatalogProductLinks,
  Migration20260429T130803CatalogGroupedAndBundle,
  Migration20260501T185835CatalogProductAttributeIsComparable,
  Migration20260505T060113CatalogAttributeOptionsAndFlags,
  Migration20260515T082629CatalogAttributeMassEditable,
  Migration20260526T124736CatalogProductStatusInactive,
  Migration20260611T140346CatalogProductValueOverridesInit,
  Migration20260611T140400CatalogAttributeQuickSearchable,
  Migration20260611T140407CatalogBulkOperations,
  Migration20260611T140408CatalogBulkOperationLogs,
  Migration20260611T140412CatalogProductPackagingUnits,
  Migration20260718T060659CatalogBulkOperationRevertState,
  Migration20260718T200343CatalogCategoryCustomFieldValues,
  Migration20260723T230401CatalogAttributesOnCustomFields,
  Migration20260804T152604CatalogWidenProductSku,
  Migration20260804T160244CatalogCategoryActivation,
  Migration20260912T094557CatalogSalesChannelProducts,
  Migration20260912T094623CatalogSalesChannelCategories,
  Migration20260925T125527CatalogInventoryColumns,
];

export {
  Migration20260429T064146CatalogAttributeSetsInit,
  Migration20260429T070004CatalogProductAttributeExtensions,
  Migration20260429T102322CatalogProductTypeAndVirtualFields,
  Migration20260429T111839CatalogGalleryItemsAndLabels,
  Migration20260429T112543CatalogProductAttachments,
  Migration20260429T123726CatalogProductLinks,
  Migration20260429T130803CatalogGroupedAndBundle,
  Migration20260501T185835CatalogProductAttributeIsComparable,
  Migration20260505T060113CatalogAttributeOptionsAndFlags,
  Migration20260515T082629CatalogAttributeMassEditable,
  Migration20260526T124736CatalogProductStatusInactive,
  Migration20260611T140346CatalogProductValueOverridesInit,
  Migration20260611T140400CatalogAttributeQuickSearchable,
  Migration20260611T140407CatalogBulkOperations,
  Migration20260611T140408CatalogBulkOperationLogs,
  Migration20260611T140412CatalogProductPackagingUnits,
  Migration20260718T060659CatalogBulkOperationRevertState,
  Migration20260718T200343CatalogCategoryCustomFieldValues,
  Migration20260723T230401CatalogAttributesOnCustomFields,
  Migration20260804T152604CatalogWidenProductSku,
  Migration20260804T160244CatalogCategoryActivation,
  Migration20260912T094557CatalogSalesChannelProducts,
  Migration20260912T094623CatalogSalesChannelCategories,
  Migration20260925T125527CatalogInventoryColumns,
};
