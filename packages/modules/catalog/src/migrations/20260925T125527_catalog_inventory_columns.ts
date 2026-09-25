import { Migration } from '@mikro-orm/migrations';

/**
 * The nine stock-management columns `catalog`'s entities map, and the two
 * check constraints that enforce their string unions, created by `catalog`.
 *
 * `Product` maps `manage_stock`, `backorder_enabled`, `low_stock_threshold`,
 * `low_stock_threshold_mode`, `fulfilment_strategy` and
 * `fulfilment_strategy_warehouse_order`; `Category` maps
 * `inventory_threshold_{high,medium,low}`. Until feature 134
 * (`specs/134-paid-module-extraction/research.md` D15) only `inventory`'s
 * `Migration20260503T182812InventoryWorkflow` and
 * `Migration20260611T140348InventoryPerWarehouseLowStockThresholds` created
 * them. `inventory` is switchable and outside `catalog`'s dependencies, so an
 * instance assembled without it could not read a product, and its hard
 * uninstall dropped the columns. Those two migrations keep their class names
 * and lost only these statements.
 *
 * **`if not exists` and `pg_constraint` probes**, because every database that
 * ran `inventory`'s migrations already has all of it, and there this must be a
 * no-op that keeps every value. PostgreSQL has no `add constraint if not
 * exists`; the probe form follows `quote_requests`' `20260912T125614`. Types,
 * nullability, defaults and constraint definitions are copied verbatim from
 * `inventory`'s statements.
 *
 * **`down()` is deliberately empty.** `products` and `categories` are created
 * by the platform's `core_foundation_init`, which a hard uninstall of this
 * module never reverts, so their rows outlive `catalog`. Dropping the columns
 * would silently reset every surviving row's stock settings on the next
 * install: a down that removes columns from rows that survive is data loss,
 * not a revert.
 */
export class Migration20260925T125527CatalogInventoryColumns extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "products"
        add column if not exists "manage_stock" boolean not null default true,
        add column if not exists "backorder_enabled" boolean not null default false,
        add column if not exists "low_stock_threshold" int null,
        add column if not exists "fulfilment_strategy" varchar(32) null,
        add column if not exists "fulfilment_strategy_warehouse_order" jsonb null,
        add column if not exists "low_stock_threshold_mode" varchar(16) not null default 'cumulative';
    `);
    this.addSql(`
      alter table "categories"
        add column if not exists "inventory_threshold_high" int null,
        add column if not exists "inventory_threshold_medium" int null,
        add column if not exists "inventory_threshold_low" int null;
    `);
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint
          where "conname" = 'products_fulfilment_strategy_check'
            and "conrelid" = '"products"'::regclass
        ) then
          alter table "products"
            add constraint "products_fulfilment_strategy_check"
            check (
              "fulfilment_strategy" is null
              or "fulfilment_strategy" in (
                'any','default_first','lowest_stock_first','highest_stock_first','defined_order'
              )
            );
        end if;
      end $$;
    `);
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint
          where "conname" = 'products_low_stock_threshold_mode_check'
            and "conrelid" = '"products"'::regclass
        ) then
          alter table "products"
            add constraint "products_low_stock_threshold_mode_check"
            check ("low_stock_threshold_mode" in ('cumulative', 'per_warehouse'));
        end if;
      end $$;
    `);
  }

  override async down(): Promise<void> {
    // Intentionally empty — see the class comment.
  }
}
