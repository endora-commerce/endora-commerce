import { Migration } from '@mikro-orm/migrations';

/**
 * Per-warehouse low-stock thresholds.
 *
 * Adds the `product_warehouse_low_stock_thresholds` table holding (product,
 * warehouse) thresholds. Only consulted when the product is in
 * `per_warehouse` mode.
 *
 * It used to add `products.low_stock_threshold_mode` ('cumulative' |
 * 'per_warehouse', default 'cumulative') and
 * `products_low_stock_threshold_mode_check` as well, and to drop both on
 * revert. That column is `catalog`'s — its `Product` entity maps it — and since
 * feature 134 (`specs/134-paid-module-extraction/research.md` D15) it is
 * created by `catalog`'s `Migration20260925T125527CatalogInventoryColumns`.
 * This migration keeps its class name and lost only those statements. The
 * `pwlst_product_fk` reference to `products` stays: it is a foreign key from
 * this module's own table to a module it declares.
 *
 * Resolution chain in `per_warehouse` mode (per warehouse):
 *   1. Row in `product_warehouse_low_stock_thresholds`.
 *   2. `warehouses.default_low_stock_threshold` fallback.
 *   3. No threshold.
 */
export class Migration20260611T140348InventoryPerWarehouseLowStockThresholds extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "product_warehouse_low_stock_thresholds" (
        "product_id" uuid not null,
        "warehouse_id" uuid not null,
        "threshold" int not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "product_warehouse_low_stock_thresholds_pkey"
          primary key ("product_id", "warehouse_id"),
        constraint "pwlst_threshold_nonneg" check ("threshold" >= 0),
        constraint "pwlst_product_fk"
          foreign key ("product_id") references "products" ("id") on delete cascade,
        constraint "pwlst_warehouse_fk"
          foreign key ("warehouse_id") references "warehouses" ("id") on delete cascade
      );
    `);
    this.addSql(
      `create index "pwlst_warehouse_idx" on "product_warehouse_low_stock_thresholds" ("warehouse_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop table if exists "product_warehouse_low_stock_thresholds" cascade;`,
    );
  }
}
