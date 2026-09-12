/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * Listed in ascending timestamp, which orders **this module's own** migrations
 * and nothing else (feature 081). Where the block sits relative to every other
 * module's is decided by the manifest `dependencies` graph.
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

import { Migration20260503T182812InventoryWorkflow } from './20260503T182812_inventory_workflow.js';
import { Migration20260611T140347InventoryWarehouseDefaultLowStockThreshold } from './20260611T140347_inventory_warehouse_default_low_stock_threshold.js';
import { Migration20260611T140348InventoryPerWarehouseLowStockThresholds } from './20260611T140348_inventory_per_warehouse_low_stock_thresholds.js';
import { Migration20260818T081243InventoryStockAllocationOrderItemFk } from './20260818T081243_inventory_stock_allocation_order_item_fk.js';
import { Migration20260830T182139InventoryOrganizationAttribution } from './20260830T182139_inventory_organization_attribution.js';
import { Migration20260912T125716InventoryOrganizationWarehouses } from './20260912T125716_inventory_organization_warehouses.js';

export const migrations = [
  Migration20260503T182812InventoryWorkflow,
  Migration20260611T140347InventoryWarehouseDefaultLowStockThreshold,
  Migration20260611T140348InventoryPerWarehouseLowStockThresholds,
  Migration20260818T081243InventoryStockAllocationOrderItemFk,
  Migration20260830T182139InventoryOrganizationAttribution,
  Migration20260912T125716InventoryOrganizationWarehouses,
];

export {
  Migration20260503T182812InventoryWorkflow,
  Migration20260611T140347InventoryWarehouseDefaultLowStockThreshold,
  Migration20260611T140348InventoryPerWarehouseLowStockThresholds,
  Migration20260818T081243InventoryStockAllocationOrderItemFk,
  Migration20260830T182139InventoryOrganizationAttribution,
  Migration20260912T125716InventoryOrganizationWarehouses,
};
