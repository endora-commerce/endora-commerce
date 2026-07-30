import { Migration } from '@mikro-orm/migrations';

/**
 * Price Lists engine — feature 011 schema reshape (additive rollout).
 *
 * What this migration does, in order (data-model.md §7):
 *   1. Acquire an advisory lock to coalesce concurrent migrators.
 *   2. Add the engine columns to `price_lists`: type, status, starts_at,
 *      ends_at, modified_at, application_rule (JSONB), is_system. The legacy
 *      columns (code, currency, priority, is_default) remain in place — they
 *      will be dropped by a follow-up migration once every reader migrates to
 *      the engine resolver. Widen `name` from varchar(160) to varchar(200).
 *   3. Create `price_list_products` (assignment join).
 *   4. Create `price_list_price_brackets` (multi-currency multi-bracket per
 *      pair; service-layer overlap check, not a DB constraint — research §R3).
 *   5. Create `price_display_mode_overrides` (Org/Cat/Product overrides).
 *   6. Seed the `Default` price list with deterministic UUID
 *      `00000000-0000-4000-8000-00000000d51b`. Idempotent: ON CONFLICT
 *      (id) DO UPDATE keeps both the legacy AND engine columns coherent.
 *   7. Migrate every Product's `attributeValues.defaultPrice` (with
 *      `attributeValues.price` as fallback) into one bracket row per
 *      currency exposed by any sales channel (research §R7). The legacy
 *      JSONB key is NOT stripped; existing readers continue to work.
 *
 * The migration is idempotent: re-running adds no rows, no columns are
 * re-altered (PostgreSQL's "if not exists" guards every DDL), and the seed
 * row's deterministic UUID prevents duplication.
 */

const DEFAULT_PRICE_LIST_ID = '00000000-0000-4000-8000-00000000d51b';
const ADVISORY_LOCK_KEY = 11; // feature number, namespaced into pg_advisory_xact_lock.

export class Migration20260504T125655PriceListsEngine extends Migration {
  override async up(): Promise<void> {
    // ============================================================
    // 1. Advisory lock — coalesce concurrent migrators
    // ============================================================
    this.addSql(`select pg_advisory_xact_lock(${ADVISORY_LOCK_KEY});`);

    // ============================================================
    // 2. price_lists — additive engine columns
    // ============================================================
    this.addSql(`alter table "price_lists" alter column "name" type varchar(200);`);
    this.addSql(`
      alter table "price_lists"
        add column if not exists "type" varchar(8) not null default 'base',
        add column if not exists "status" varchar(16) not null default 'draft',
        add column if not exists "starts_at" timestamptz null,
        add column if not exists "ends_at" timestamptz null,
        add column if not exists "modified_at" timestamptz not null default now(),
        add column if not exists "application_rule" jsonb not null default '{"kind":"all"}'::jsonb,
        add column if not exists "is_system" boolean not null default false;
    `);
    this.addSql(`
      alter table "price_lists"
        drop constraint if exists "price_lists_type_check";
    `);
    this.addSql(`
      alter table "price_lists"
        add constraint "price_lists_type_check" check ("type" in ('base','sale'));
    `);
    this.addSql(`
      alter table "price_lists"
        drop constraint if exists "price_lists_status_check";
    `);
    this.addSql(`
      alter table "price_lists"
        add constraint "price_lists_status_check"
          check ("status" in ('draft','active','scheduled','expired'));
    `);
    this.addSql(`
      alter table "price_lists"
        drop constraint if exists "price_lists_dates_check";
    `);
    this.addSql(`
      alter table "price_lists"
        add constraint "price_lists_dates_check"
          check ("ends_at" is null or "starts_at" is null or "ends_at" > "starts_at");
    `);
    this.addSql(`create index if not exists "price_lists_status_idx" on "price_lists" ("status");`);
    this.addSql(`create index if not exists "price_lists_type_idx" on "price_lists" ("type");`);
    this.addSql(`create index if not exists "price_lists_modified_at_idx" on "price_lists" ("modified_at" desc);`);
    this.addSql(`
      create index if not exists "price_lists_status_starts_at_idx"
        on "price_lists" ("starts_at")
        where "status" = 'scheduled';
    `);
    this.addSql(`
      create index if not exists "price_lists_status_ends_at_idx"
        on "price_lists" ("ends_at")
        where "status" = 'active' and "ends_at" is not null;
    `);

    // ============================================================
    // 3. price_list_products — assignment join
    // ============================================================
    this.addSql(`
      create table if not exists "price_list_products" (
        "price_list_id" uuid not null,
        "product_id" uuid not null,
        "created_at" timestamptz not null default now(),
        constraint "price_list_products_pkey" primary key ("price_list_id", "product_id"),
        constraint "price_list_products_list_fk"
          foreign key ("price_list_id") references "price_lists" ("id") on delete cascade,
        constraint "price_list_products_product_fk"
          foreign key ("product_id") references "products" ("id") on delete cascade
      );
    `);
    this.addSql(`
      create index if not exists "price_list_products_product_idx"
        on "price_list_products" ("product_id");
    `);

    // ============================================================
    // 4. price_list_price_brackets — multi-currency multi-bracket prices
    // ============================================================
    this.addSql(`
      create table if not exists "price_list_price_brackets" (
        "price_list_id" uuid not null,
        "product_id" uuid not null,
        "currency_code" varchar(3) not null,
        "min_quantity" integer not null,
        "max_quantity" integer null,
        "amount" numeric(14, 4) not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "price_list_price_brackets_pkey"
          primary key ("price_list_id", "product_id", "currency_code", "min_quantity"),
        constraint "price_list_price_brackets_min_qty_check" check ("min_quantity" >= 1),
        constraint "price_list_price_brackets_max_qty_check"
          check ("max_quantity" is null or "max_quantity" >= "min_quantity"),
        constraint "price_list_price_brackets_amount_check" check ("amount" >= 0),
        constraint "price_list_price_brackets_assignment_fk"
          foreign key ("price_list_id", "product_id")
          references "price_list_products" ("price_list_id", "product_id")
          on delete cascade
      );
    `);

    // ============================================================
    // 5. price_display_mode_overrides — Org/Cat/Product overrides
    // ============================================================
    this.addSql(`
      create table if not exists "price_display_mode_overrides" (
        "scope" varchar(16) not null,
        "target_id" uuid not null,
        "mode" varchar(16) not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "price_display_mode_overrides_pkey" primary key ("scope", "target_id"),
        constraint "price_display_mode_overrides_scope_check"
          check ("scope" in ('organization','category','product')),
        constraint "price_display_mode_overrides_mode_check"
          check ("mode" in ('gross_only','net_only','both','none'))
      );
    `);

    // ============================================================
    // 6. Seed Default price list (idempotent via deterministic UUID).
    //    If a different price_list already carries is_default=true (e.g. a
    //    pre-feature-011 dev seed produced one with a random UUID like
    //    `default_pln`), re-point its children onto the deterministic row and
    //    drop the legacy row. Without this, the partial unique index
    //    `uniq_price_lists_one_default` (created by migration 014) blocks the
    //    seed insert.
    // ============================================================
    this.addSql(`
      do $$
      declare
        v_target_id uuid := '${DEFAULT_PRICE_LIST_ID}'::uuid;
        v_legacy_id uuid;
      begin
        select "id" into v_legacy_id
          from "price_lists"
          where "is_default" = true and "id" <> v_target_id
          limit 1;

        if v_legacy_id is not null then
          -- Release the partial unique index before inserting the deterministic row.
          update "price_lists" set "is_default" = false where "id" = v_legacy_id;
        end if;

        insert into "price_lists" (
          "id", "code", "name", "currency",
          "is_default", "priority",
          "type", "status", "modified_at",
          "application_rule", "is_system",
          "created_at", "updated_at"
        )
        values (
          v_target_id, 'default', 'Default', 'PLN',
          true, 0,
          'base', 'active', now(),
          '{"kind":"all"}'::jsonb, true,
          now(), now()
        )
        on conflict ("id") do update set
          "name" = excluded."name",
          "type" = excluded."type",
          "status" = excluded."status",
          "is_default" = true,
          "is_system" = excluded."is_system",
          "application_rule" = excluded."application_rule";

        if v_legacy_id is not null then
          -- Re-point legacy-feature-014 children onto the deterministic row,
          -- then delete the legacy row.
          update "price_list_items"
            set "price_list_id" = v_target_id
            where "price_list_id" = v_legacy_id;
          update "price_list_assignments"
            set "price_list_id" = v_target_id
            where "price_list_id" = v_legacy_id;
          delete from "price_lists" where "id" = v_legacy_id;
        end if;
      end
      $$;
    `);

    // ============================================================
    // 7. Migrate legacy attributeValues.defaultPrice → bracket rows
    //    (one row per currency exposed by any sales channel; identity copy
    //     per Q3 / FR-002. Legacy keys are NOT stripped — see expand→migrate
    //     →contract note in Phase 2 of tasks.md.)
    // ============================================================
    this.addSql(`
      with currencies as (
        select distinct upper(c::text) as code
        from sales_channels sc, lateral jsonb_array_elements_text(sc.currencies) as c
        where length(c) = 3
      ),
      legacy_priced as (
        select
          p."id" as product_id,
          coalesce(
            (p."attribute_values"->>'defaultPrice')::numeric,
            (p."attribute_values"->>'price')::numeric
          ) as legacy_price
        from "products" p
        where (p."attribute_values" ? 'defaultPrice') or (p."attribute_values" ? 'price')
      ),
      assignment_upserts as (
        insert into "price_list_products" ("price_list_id", "product_id", "created_at")
        select '${DEFAULT_PRICE_LIST_ID}'::uuid, lp.product_id, now()
        from legacy_priced lp
        on conflict ("price_list_id", "product_id") do nothing
        returning 1
      )
      insert into "price_list_price_brackets" (
        "price_list_id", "product_id", "currency_code",
        "min_quantity", "max_quantity", "amount",
        "created_at", "updated_at"
      )
      select
        '${DEFAULT_PRICE_LIST_ID}'::uuid,
        lp.product_id,
        c.code,
        1,
        null,
        lp.legacy_price,
        now(),
        now()
      from legacy_priced lp
      cross join currencies c
      where lp.legacy_price is not null and lp.legacy_price >= 0
      on conflict ("price_list_id", "product_id", "currency_code", "min_quantity") do nothing;
    `);

    // Fallback: deployments that have not yet seeded sales-channel currencies
    // get a single PLN row per product so the seed at least covers the
    // platform's default currency. Idempotent.
    this.addSql(`
      with legacy_priced as (
        select
          p."id" as product_id,
          coalesce(
            (p."attribute_values"->>'defaultPrice')::numeric,
            (p."attribute_values"->>'price')::numeric
          ) as legacy_price
        from "products" p
        where (p."attribute_values" ? 'defaultPrice') or (p."attribute_values" ? 'price')
      ),
      ensure_assignment as (
        insert into "price_list_products" ("price_list_id", "product_id", "created_at")
        select '${DEFAULT_PRICE_LIST_ID}'::uuid, product_id, now()
        from legacy_priced
        on conflict ("price_list_id", "product_id") do nothing
        returning 1
      )
      insert into "price_list_price_brackets" (
        "price_list_id", "product_id", "currency_code",
        "min_quantity", "max_quantity", "amount",
        "created_at", "updated_at"
      )
      select
        '${DEFAULT_PRICE_LIST_ID}'::uuid, product_id, 'PLN', 1, null,
        legacy_price, now(), now()
      from legacy_priced
      where legacy_price is not null and legacy_price >= 0
      on conflict ("price_list_id", "product_id", "currency_code", "min_quantity") do nothing;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "price_list_price_brackets" cascade;`);
    this.addSql(`drop table if exists "price_list_products" cascade;`);
    this.addSql(`drop table if exists "price_display_mode_overrides" cascade;`);

    this.addSql(`drop index if exists "price_lists_status_idx";`);
    this.addSql(`drop index if exists "price_lists_type_idx";`);
    this.addSql(`drop index if exists "price_lists_modified_at_idx";`);
    this.addSql(`drop index if exists "price_lists_status_starts_at_idx";`);
    this.addSql(`drop index if exists "price_lists_status_ends_at_idx";`);

    this.addSql(`alter table "price_lists" drop constraint if exists "price_lists_dates_check";`);
    this.addSql(`alter table "price_lists" drop constraint if exists "price_lists_status_check";`);
    this.addSql(`alter table "price_lists" drop constraint if exists "price_lists_type_check";`);

    this.addSql(`
      alter table "price_lists"
        drop column if exists "is_system",
        drop column if exists "application_rule",
        drop column if exists "modified_at",
        drop column if exists "ends_at",
        drop column if exists "starts_at",
        drop column if exists "status",
        drop column if exists "type";
    `);

    // Note: the seeded Default row, if it survived, stays — drop logic
    // is left to a future contract migration once 014's tables are dropped.
  }
}
