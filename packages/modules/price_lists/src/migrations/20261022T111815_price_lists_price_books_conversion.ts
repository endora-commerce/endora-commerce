import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 160 (D-287 P1) — the one-shot **conversion** to price books, steps
 * 2–5 of `specs/160-pricing-model-v2/contracts/conversion-and-removal.md` §1
 * (research R4; FR-041, FR-042, N13). It reads and writes only this module's
 * own tables, and reads the kernel's `sales_channels`.
 *
 * 2. One system **base book** per currency a Default-list bracket uses, plus
 *    the platform default currency (the system-default channel's
 *    `default_currency`). The old Default list (`…d51b`) already is the base
 *    book of its currency, PLN on every installation, and keeps its id.
 * 3. Every Default-list bracket becomes a fixed product row of its currency's
 *    base book. A product the base book already prices — a base price written
 *    through the new API before this ran — keeps that price: it is what the
 *    transitional resolver charged, so nothing a buyer was charged changes.
 * 4. Every non-system list of the old model (one carrying an Application rule)
 *    is deleted with its roster, brackets, rule, matrix entries and feature-014
 *    rows (N13: development lists are dropped and reseeded, not converted).
 *    Old-model matrix entries left on a kept list — the Default list's own
 *    category discounts and organization-scoped rows — go too. A price book
 *    written through the new API before this ran is kept.
 * 5. The old model's storage goes: `price_list_products`,
 *    `price_list_price_brackets`, the feature-014 `price_list_items` and
 *    `price_list_assignments`; `price_lists.application_rule`, `code`,
 *    `is_default` and `modified_at`; the matrix entries' `organization_id`,
 *    `currency_code` and `discount_percent`. The type `base` is renamed
 *    `regular`, and the CHECKs admit only the price-book shapes.
 *
 * The catalogue's `defaultPrice` and `price_override` are **not** converted
 * (owner ruling, research R2): `catalog`'s own migration of this release
 * removes them, and it runs first.
 *
 * Every built price-surface profile is dropped: prices changed outside any
 * audited write, and the next price-sorted request registers its profile and
 * asks the worker to build it (`contracts/price-surface.md` §3).
 *
 * `down` gives the old model's storage back **empty** and leaves the base
 * rows where they are: the step is one-way for data, so a rollback leaves a
 * reseedable database rather than a half-converted one (R4).
 */
const DEFAULT_LIST_ID = '00000000-0000-4000-8000-00000000d51b';

export class Migration20261022T111815PriceListsPriceBooksConversion extends Migration {
  override async up(): Promise<void> {
    // ── 2. a base book per currency
    this.addSql(`
      insert into "price_lists"
        ("id", "code", "name", "currency_code", "is_default", "priority", "type", "status",
         "application_rule", "is_system", "audience_kind", "version", "ever_activated",
         "modified_at", "created_at", "updated_at")
      select gen_random_uuid(), 'base-' || lower(c."currency"), 'Base prices (' || c."currency" || ')', c."currency",
             false, 0, 'regular', 'active', null, true, 'everyone', 1, true, now(), now(), now()
        from (
          select distinct upper(trim("currency_code")) as "currency"
            from "price_list_price_brackets" where "price_list_id" = '${DEFAULT_LIST_ID}'
          union
          select coalesce(
            (select upper(trim("default_currency")) from "sales_channels" where "system_default" = true limit 1),
            'PLN')
        ) c
       where not exists (
         select 1 from "price_lists" b where b."is_system" = true and b."currency_code" = c."currency"
       );`);

    // ── 3. the Default brackets become base rows of their currency
    this.addSql(`
      insert into "price_list_matrix_entries"
        ("id", "price_list_id", "product_id", "min_quantity", "max_quantity", "price_type", "amount",
         "created_at", "updated_at")
      select gen_random_uuid(), b."id", k."product_id", k."min_quantity", k."max_quantity", 'fixed', k."amount", now(), now()
        from "price_list_price_brackets" k
        join "price_lists" b on b."is_system" = true and b."currency_code" = upper(trim(k."currency_code"))
       where k."price_list_id" = '${DEFAULT_LIST_ID}'
         and not exists (
           select 1 from "price_list_matrix_entries" e
            where e."price_list_id" = b."id" and e."product_id" = k."product_id" and e."variant_id" is null
              and e."organization_id" is null and e."currency_code" is null and e."price_type" <> 'discount_percent'
         );`);

    // ── 4. the old model's lists and rows
    this.addSql(`delete from "price_lists" where "is_system" = false and "application_rule" is not null;`);
    this.addSql(`
      delete from "price_list_matrix_entries"
       where "organization_id" is not null or "currency_code" is not null or "price_type" = 'discount_percent';`);

    // ── 5. the old model's storage
    this.addSql(`drop table if exists "price_list_price_brackets" cascade;`);
    this.addSql(`drop table if exists "price_list_products" cascade;`);
    this.addSql(`drop table if exists "price_list_items" cascade;`);
    this.addSql(`drop table if exists "price_list_assignments" cascade;`);

    this.addSql(`alter table "price_lists" drop constraint if exists "price_lists_type_check";`);
    this.addSql(`update "price_lists" set "type" = 'regular' where "type" = 'base';`);
    this.addSql(
      `update "price_lists" set "name" = 'Base prices (' || trim("currency_code") || ')'
        where "is_system" = true and "name" = 'Default';`,
    );
    this.addSql(
      `update "price_lists" set "status" = 'active', "audience_kind" = 'everyone', "ever_activated" = true,
              "starts_at" = null, "ends_at" = null
        where "is_system" = true;`,
    );
    this.addSql(
      `alter table "price_lists" add constraint "price_lists_type_check" check ("type" in ('regular', 'sale'));`,
    );
    this.addSql(`alter table "price_lists" alter column "type" set default 'regular';`);
    this.addSql(`drop index if exists "uniq_price_lists_one_default";`);
    this.addSql(`drop index if exists "price_lists_modified_at_idx";`);
    this.addSql(`alter table "price_lists" drop constraint if exists "price_lists_code_unique";`);
    this.addSql(`alter table "price_lists" drop column if exists "application_rule";`);
    this.addSql(`alter table "price_lists" drop column if exists "code";`);
    this.addSql(`alter table "price_lists" drop column if exists "is_default";`);
    this.addSql(`alter table "price_lists" drop column if exists "modified_at";`);

    this.addSql(`alter table "price_list_matrix_entries" drop constraint if exists "price_list_matrix_entries_price_check";`);
    this.addSql(
      `alter table "price_list_matrix_entries" drop constraint if exists "price_list_matrix_entries_price_type_check";`,
    );
    this.addSql(`drop index if exists "price_list_matrix_entries_list_org_idx";`);
    this.addSql(`drop index if exists "price_list_matrix_entries_organization_idx";`);
    this.addSql(`alter table "price_list_matrix_entries" drop column if exists "organization_id";`);
    this.addSql(`alter table "price_list_matrix_entries" drop column if exists "currency_code";`);
    this.addSql(`alter table "price_list_matrix_entries" drop column if exists "discount_percent";`);
    this.addSql(
      `alter table "price_list_matrix_entries" add constraint "price_list_matrix_entries_price_type_check"
         check ("price_type" in ('fixed', 'percent', 'amount'));`,
    );
    this.addSql(`alter table "price_list_matrix_entries" add constraint "price_list_matrix_entries_price_check" check (
      ("price_type" = 'fixed'
         and "amount" is not null and "amount" >= 0 and "percent" is null
         and ("variant_id" is not null or "product_id" is not null or "category_id" is not null or "attribute_key" is not null))
      or
      ("price_type" = 'percent'
         and "percent" is not null and "percent" >= -100 and "percent" <= 1000 and "amount" is null)
      or
      ("price_type" = 'amount' and "amount" is not null and "percent" is null)
    );`);

    this.addSql(`delete from "price_profiles";`);
  }

  override async down(): Promise<void> {
    // The rows' old coordinates, empty.
    this.addSql(`alter table "price_list_matrix_entries" drop constraint if exists "price_list_matrix_entries_price_check";`);
    this.addSql(
      `alter table "price_list_matrix_entries" drop constraint if exists "price_list_matrix_entries_price_type_check";`,
    );
    this.addSql(`alter table "price_list_matrix_entries" add column if not exists "organization_id" uuid null;`);
    this.addSql(`alter table "price_list_matrix_entries" add column if not exists "currency_code" char(3) null;`);
    this.addSql(`alter table "price_list_matrix_entries" add column if not exists "discount_percent" numeric(5,2) null;`);
    this.addSql(
      `alter table "price_list_matrix_entries" add constraint "price_list_matrix_entries_organization_id_foreign"
         foreign key ("organization_id") references "organizations" ("id") on delete cascade;`,
    );
    this.addSql(
      `create index if not exists "price_list_matrix_entries_list_org_idx" on "price_list_matrix_entries" ("price_list_id", "organization_id");`,
    );
    this.addSql(
      `create index if not exists "price_list_matrix_entries_organization_idx" on "price_list_matrix_entries" ("organization_id") where "organization_id" is not null;`,
    );
    this.addSql(
      `alter table "price_list_matrix_entries" add constraint "price_list_matrix_entries_price_type_check"
         check ("price_type" in ('fixed', 'percent', 'amount', 'discount_percent'));`,
    );
    this.addSql(`alter table "price_list_matrix_entries" add constraint "price_list_matrix_entries_price_check" check (
      ("price_type" = 'fixed'
         and "amount" is not null and "amount" >= 0
         and "discount_percent" is null and "percent" is null
         and ("variant_id" is not null or "product_id" is not null or "category_id" is not null or "attribute_key" is not null))
      or
      ("price_type" = 'percent'
         and "percent" is not null and "percent" >= -100 and "percent" <= 1000
         and "amount" is null and "discount_percent" is null and "currency_code" is null)
      or
      ("price_type" = 'amount'
         and "amount" is not null
         and "percent" is null and "discount_percent" is null and "currency_code" is null)
      or
      ("price_type" = 'discount_percent'
         and "discount_percent" > 0 and "discount_percent" <= 100
         and "amount" is null and "currency_code" is null and "percent" is null and "variant_id" is null)
    );`);

    // The header's old columns. A price book carries no rule; the old Default
    // list's id is the one system list the old model knew.
    this.addSql(`alter table "price_lists" add column if not exists "application_rule" jsonb null default '{"kind":"all"}'::jsonb;`);
    this.addSql(
      `update "price_lists" set "application_rule" = case when "id" = '${DEFAULT_LIST_ID}' then '{"kind":"all"}'::jsonb else null end;`,
    );
    this.addSql(`alter table "price_lists" add column if not exists "code" varchar(64) null;`);
    this.addSql(
      `update "price_lists" set "code" = case when "id" = '${DEFAULT_LIST_ID}' then 'default' else 'pb-' || "id"::text end;`,
    );
    this.addSql(`alter table "price_lists" alter column "code" set not null;`);
    this.addSql(`alter table "price_lists" add constraint "price_lists_code_unique" unique ("code");`);
    this.addSql(`alter table "price_lists" add column if not exists "is_default" boolean not null default false;`);
    this.addSql(`update "price_lists" set "is_default" = ("id" = '${DEFAULT_LIST_ID}');`);
    this.addSql(
      `create unique index if not exists "uniq_price_lists_one_default" on "price_lists" ("is_default") where "is_default" = true;`,
    );
    this.addSql(`alter table "price_lists" add column if not exists "modified_at" timestamptz not null default now();`);
    this.addSql(`create index if not exists "price_lists_modified_at_idx" on "price_lists" ("modified_at" desc);`);
    this.addSql(`alter table "price_lists" drop constraint if exists "price_lists_type_check";`);
    this.addSql(`update "price_lists" set "type" = 'base' where "id" = '${DEFAULT_LIST_ID}';`);
    this.addSql(
      `alter table "price_lists" add constraint "price_lists_type_check" check ("type" in ('base', 'regular', 'sale'));`,
    );
    this.addSql(`alter table "price_lists" alter column "type" set default 'base';`);

    // The old model's tables, empty.
    this.addSql(`create table if not exists "price_list_products" (
      "price_list_id" uuid not null,
      "product_id" uuid not null,
      "created_at" timestamptz not null default now(),
      constraint "price_list_products_pkey" primary key ("price_list_id", "product_id"),
      constraint "price_list_products_list_fk" foreign key ("price_list_id") references "price_lists" ("id") on delete cascade,
      constraint "price_list_products_product_fk" foreign key ("product_id") references "products" ("id") on delete cascade
    );`);
    this.addSql(`create index if not exists "price_list_products_product_idx" on "price_list_products" ("product_id");`);
    this.addSql(`create table if not exists "price_list_price_brackets" (
      "price_list_id" uuid not null,
      "product_id" uuid not null,
      "currency_code" varchar(3) not null,
      "min_quantity" integer not null,
      "max_quantity" integer null,
      "amount" numeric(14,4) not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      constraint "price_list_price_brackets_pkey" primary key ("price_list_id", "product_id", "currency_code", "min_quantity"),
      constraint "price_list_price_brackets_assignment_fk" foreign key ("price_list_id", "product_id")
        references "price_list_products" ("price_list_id", "product_id") on delete cascade,
      constraint "price_list_price_brackets_amount_check" check ("amount" >= 0),
      constraint "price_list_price_brackets_min_qty_check" check ("min_quantity" >= 1),
      constraint "price_list_price_brackets_max_qty_check" check ("max_quantity" is null or "max_quantity" >= "min_quantity")
    );`);
    this.addSql(
      `create index if not exists "price_list_price_brackets_unit_amount_idx"
         on "price_list_price_brackets" ("price_list_id", "currency_code", "amount", "product_id") where "min_quantity" = 1;`,
    );
    this.addSql(`create table if not exists "price_list_items" (
      "id" uuid not null,
      "price_list_id" uuid not null,
      "mode" varchar(255) not null,
      "product_id" uuid null,
      "variant_id" uuid null,
      "category_id" uuid null,
      "min_quantity" integer not null default 1,
      "unit_price" numeric(12,2) null,
      "adjustment_value" numeric(12,2) null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "price_list_items_pkey" primary key ("id"),
      constraint "price_list_items_price_list_fk" foreign key ("price_list_id") references "price_lists" ("id") on delete cascade
    );`);
    this.addSql(`create index if not exists "price_list_items_price_list_id_index" on "price_list_items" ("price_list_id");`);
    this.addSql(`create index if not exists "price_list_items_product_id_index" on "price_list_items" ("product_id");`);
    this.addSql(`create index if not exists "price_list_items_category_id_index" on "price_list_items" ("category_id");`);
    this.addSql(`create index if not exists "price_list_items_mode_index" on "price_list_items" ("mode");`);
    this.addSql(`create table if not exists "price_list_assignments" (
      "id" uuid not null,
      "price_list_id" uuid not null,
      "organization_id" uuid null,
      "customer_group_id" uuid null,
      "sales_channel_id" uuid null,
      "is_default" boolean not null default false,
      "priority" integer not null default 0,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "price_list_assignments_pkey" primary key ("id"),
      constraint "price_list_assignments_price_list_fk" foreign key ("price_list_id") references "price_lists" ("id") on delete cascade
    );`);
    this.addSql(
      `create index if not exists "price_list_assignments_price_list_id_index" on "price_list_assignments" ("price_list_id");`,
    );
    this.addSql(
      `create index if not exists "price_list_assignments_organization_id_index" on "price_list_assignments" ("organization_id");`,
    );
    this.addSql(
      `create index if not exists "price_list_assignments_customer_group_id_index" on "price_list_assignments" ("customer_group_id");`,
    );
  }
}
