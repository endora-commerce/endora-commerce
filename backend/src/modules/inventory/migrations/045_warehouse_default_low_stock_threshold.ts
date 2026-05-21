import { Migration } from '@mikro-orm/migrations';

/**
 * Adds `default_low_stock_threshold` to `warehouses`. When a Product has
 * no per-product `low_stock_threshold`, this column acts as the fallback
 * threshold for that warehouse's contribution to the low-stock signal.
 *
 * Nullable so existing rows (including the seeded `Default` warehouse)
 * stay untouched until an operator opts in.
 */
export class Migration045WarehouseDefaultLowStockThreshold extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "warehouses" add column "default_low_stock_threshold" int null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "warehouses" drop column if exists "default_low_stock_threshold";`,
    );
  }
}
