import { Migration } from '@mikro-orm/migrations';

/**
 * Inventory module — multi-warehouse rewrite (feature 010).
 *
 * What this migration does, in order (data-model.md §10):
 *   1. Create `warehouses` table; seed the `Default` warehouse with
 *      deterministic UUID `00000000-0000-4000-8000-00000000d017`.
 *   2. Add `warehouse_id` to `stock_levels`, backfill every existing
 *      row to the Default UUID, swap the unique index to include
 *      warehouse_id.
 *   3. Create `warehouse_channel_assignments`; for every existing
 *      sales channel insert a `(default_warehouse, channel, isDefault=true)`
 *      seed row.
 *   4. Extend `availability_notifications` with `email` + `status`
 *      columns, relax `customer_account_id` to nullable, add the
 *      "at least one recipient" CHECK constraint.
 *   5. Extend `products` with the new stock-management columns.
 *   6. Extend `categories` with the three threshold columns.
 *   7. Create `inventory_thresholds`; insert the global row at
 *      foundation defaults (high=100, medium=20, low=1).
 *   8. Create `stock_allocations`.
 *
 * The deterministic seed UUID lets retried migrations stay
 * idempotent and lets other modules' tests reference the Default
 * warehouse by id.
 */
export class Migration20260503T182812InventoryWorkflow extends Migration {
  override async up(): Promise<void> {
    // ============================================================
    // 1. warehouses
    // ============================================================
    this.addSql(`
      create table "warehouses" (
        "id" uuid not null,
        "name" varchar(160) not null,
        "code" varchar(64) not null,
        "active" boolean not null default true,
        "description" text null,
        "address" jsonb null,
        "contact_name" varchar(160) null,
        "contact_email" varchar(320) null,
        "contact_phone" varchar(64) null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "warehouses_pkey" primary key ("id"),
        constraint "warehouses_code_unique" unique ("code"),
        constraint "warehouses_code_format_check" check ("code" ~ '^[a-z][a-z0-9_-]*[a-z0-9]$')
      );
    `);
    this.addSql(`create index "warehouses_active_idx" on "warehouses" ("active");`);

    // Seed Default warehouse with deterministic UUID for migration idempotency.
    this.addSql(`
      insert into "warehouses" ("id", "name", "code", "active", "created_at", "updated_at")
      values ('00000000-0000-4000-8000-00000000d017', 'Default', 'default', true, now(), now())
      on conflict ("id") do nothing;
    `);

    // ============================================================
    // 2. stock_levels — extend with warehouse_id
    // ============================================================
    this.addSql(`alter table "stock_levels" add column "warehouse_id" uuid null;`);
    this.addSql(`
      update "stock_levels"
         set "warehouse_id" = '00000000-0000-4000-8000-00000000d017'::uuid
       where "warehouse_id" is null;
    `);
    this.addSql(`alter table "stock_levels" alter column "warehouse_id" set not null;`);
    this.addSql(`drop index if exists "stock_levels_product_variant_unique";`);
    this.addSql(`
      create unique index "stock_levels_product_variant_warehouse_unique"
        on "stock_levels" (
          "product_id",
          coalesce("variant_id", '00000000-0000-0000-0000-000000000000'::uuid),
          "warehouse_id"
        );
    `);

    // ============================================================
    // 3. warehouse_channel_assignments
    // ============================================================
    this.addSql(`
      create table "warehouse_channel_assignments" (
        "id" uuid not null,
        "warehouse_id" uuid not null,
        "sales_channel_id" uuid not null,
        "is_default" boolean not null default false,
        "sort_order" int not null default 0,
        "created_at" timestamptz not null,
        constraint "warehouse_channel_assignments_pkey" primary key ("id"),
        constraint "wca_warehouse_fk" foreign key ("warehouse_id") references "warehouses" ("id") on delete cascade,
        constraint "wca_unique_pair" unique ("warehouse_id", "sales_channel_id")
      );
    `);
    this.addSql(`
      create unique index "wca_one_default_per_channel"
        on "warehouse_channel_assignments" ("sales_channel_id")
        where "is_default" = true;
    `);
    // Seed the Default warehouse as default for every existing channel.
    this.addSql(`
      insert into "warehouse_channel_assignments"
        ("id", "warehouse_id", "sales_channel_id", "is_default", "sort_order", "created_at")
      select gen_random_uuid(), '00000000-0000-4000-8000-00000000d017'::uuid, sc."id", true, 0, now()
        from "sales_channels" sc;
    `);

    // ============================================================
    // 4. availability_notifications — extend
    // ============================================================
    this.addSql(`alter table "availability_notifications" add column "email" varchar(320) null;`);
    this.addSql(`alter table "availability_notifications" add column "status" varchar(16) not null default 'queued';`);
    this.addSql(`alter table "availability_notifications" alter column "customer_account_id" drop not null;`);
    this.addSql(`
      alter table "availability_notifications"
        add constraint "an_recipient_check"
        check ("customer_account_id" is not null or "email" is not null);
    `);
    this.addSql(`
      alter table "availability_notifications"
        add constraint "an_status_check"
        check ("status" in ('queued','notified','cancelled'));
    `);
    this.addSql(`create index "an_product_status_idx" on "availability_notifications" ("product_id", "status");`);

    // ============================================================
    // 5. products — extend
    // ============================================================
    this.addSql(`
      alter table "products"
        add column "manage_stock" boolean not null default true,
        add column "backorder_enabled" boolean not null default false,
        add column "low_stock_threshold" int null,
        add column "fulfilment_strategy" varchar(32) null,
        add column "fulfilment_strategy_warehouse_order" jsonb null;
    `);
    this.addSql(`
      alter table "products"
        add constraint "products_fulfilment_strategy_check"
        check (
          "fulfilment_strategy" is null
          or "fulfilment_strategy" in (
            'any','default_first','lowest_stock_first','highest_stock_first','defined_order'
          )
        );
    `);

    // ============================================================
    // 6. categories — extend
    // ============================================================
    this.addSql(`
      alter table "categories"
        add column "inventory_threshold_high" int null,
        add column "inventory_threshold_medium" int null,
        add column "inventory_threshold_low" int null;
    `);

    // ============================================================
    // 7. inventory_thresholds + global seed
    // ============================================================
    this.addSql(`
      create table "inventory_thresholds" (
        "id" uuid not null,
        "scope_kind" varchar(16) not null,
        "scope_id" uuid null,
        "threshold_high" int null,
        "threshold_medium" int null,
        "threshold_low" int null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "inventory_thresholds_pkey" primary key ("id"),
        constraint "it_scope_check" check (
          ("scope_kind" = 'global' and "scope_id" is null)
          or ("scope_kind" <> 'global' and "scope_id" is not null)
        ),
        constraint "it_scope_kind_check" check ("scope_kind" in ('global','category','product'))
      );
    `);
    this.addSql(`
      create unique index "it_global_unique" on "inventory_thresholds" ("scope_kind")
        where "scope_kind" = 'global';
    `);
    this.addSql(`
      create unique index "it_scoped_unique"
        on "inventory_thresholds" ("scope_kind", "scope_id")
        where "scope_kind" <> 'global';
    `);
    this.addSql(`
      insert into "inventory_thresholds"
        ("id", "scope_kind", "scope_id", "threshold_high", "threshold_medium", "threshold_low", "created_at", "updated_at")
      values (gen_random_uuid(), 'global', null, 100, 20, 1, now(), now());
    `);

    // ============================================================
    // 8. stock_allocations
    // ============================================================
    this.addSql(`
      create table "stock_allocations" (
        "id" uuid not null,
        "order_item_id" uuid not null,
        "warehouse_id" uuid not null,
        "quantity" int not null,
        "is_backorder" boolean not null default false,
        "created_at" timestamptz not null,
        "released_at" timestamptz null,
        constraint "stock_allocations_pkey" primary key ("id"),
        constraint "sa_warehouse_fk" foreign key ("warehouse_id") references "warehouses" ("id") on delete restrict,
        constraint "sa_qty_positive" check ("quantity" > 0),
        constraint "sa_unique_per_line" unique ("order_item_id", "warehouse_id")
      );
    `);
    this.addSql(`create index "sa_warehouse_idx" on "stock_allocations" ("warehouse_id");`);
  }

  override async down(): Promise<void> {
    // Best-effort rollback — stock_allocations + warehouse_channel_assignments
    // data is lost; existing reservations may need a manual re-`reserved+=` pass.
    this.addSql(`drop table if exists "stock_allocations" cascade;`);
    this.addSql(`drop table if exists "inventory_thresholds" cascade;`);
    this.addSql(`drop table if exists "warehouse_channel_assignments" cascade;`);

    this.addSql(`alter table "categories" drop column if exists "inventory_threshold_high";`);
    this.addSql(`alter table "categories" drop column if exists "inventory_threshold_medium";`);
    this.addSql(`alter table "categories" drop column if exists "inventory_threshold_low";`);

    this.addSql(`alter table "products" drop column if exists "fulfilment_strategy_warehouse_order";`);
    this.addSql(`alter table "products" drop constraint if exists "products_fulfilment_strategy_check";`);
    this.addSql(`alter table "products" drop column if exists "fulfilment_strategy";`);
    this.addSql(`alter table "products" drop column if exists "low_stock_threshold";`);
    this.addSql(`alter table "products" drop column if exists "backorder_enabled";`);
    this.addSql(`alter table "products" drop column if exists "manage_stock";`);

    this.addSql(`alter table "availability_notifications" drop constraint if exists "an_status_check";`);
    this.addSql(`alter table "availability_notifications" drop constraint if exists "an_recipient_check";`);
    this.addSql(`drop index if exists "an_product_status_idx";`);
    this.addSql(`alter table "availability_notifications" drop column if exists "status";`);
    this.addSql(`alter table "availability_notifications" drop column if exists "email";`);
    this.addSql(`alter table "availability_notifications" alter column "customer_account_id" set not null;`);

    this.addSql(`drop index if exists "stock_levels_product_variant_warehouse_unique";`);
    this.addSql(`alter table "stock_levels" drop column if exists "warehouse_id";`);
    this.addSql(`
      create unique index "stock_levels_product_variant_unique"
        on "stock_levels" ("product_id", coalesce("variant_id", '00000000-0000-0000-0000-000000000000'::uuid));
    `);

    this.addSql(`drop table if exists "warehouses" cascade;`);
  }
}
