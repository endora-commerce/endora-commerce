import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 160 (D-287 P1) — the price-book **expand** step
 * (`specs/160-pricing-model-v2/data-model.md` §1–§6, research R4 step 1).
 *
 * Creates what the price-book model needs beside the old model, which keeps
 * working until the conversion migration of the removal phase runs (steps 2–5:
 * base books from the Default brackets, every non-system list dropped, the old
 * tables and columns removed). Both ship in the same release.
 *
 * - `price_lists` gains the book header: `currency` becomes `currency_code`
 *   (char(3), the legacy column renamed — the old engine reads it under its old
 *   property name), `audience_kind`, the `regular` type beside the legacy
 *   `base`, and one system (base) book **per currency** instead of one overall.
 *   `application_rule` becomes nullable: a price book carries none, and until
 *   the conversion drops the column a null rule is what tells the old engine a
 *   row is not one of its lists.
 * - `price_list_audience_members` — the audience set, two real FKs and a CHECK
 *   that exactly one is set (research R3).
 * - `sales_channel_price_lists` — the channel set, a Principle XII bridge
 *   registered by this module for entity type `price-list`, read and written only
 *   through `SalesChannelMembershipService`.
 * - `price_list_matrix_entries` — rows gain `variant_id`, a signed `percent`
 *   and the `amount` adjustment; a product row no longer needs an organization.
 *   The legacy `discount_percent` arm stays until the conversion.
 * - `price_list_precedence` — the versioned buyer-cell order, seeded with
 *   version 1 = **HY** (FR-021). No write path exists in P1 (FR-023).
 * - `price_profiles` / `price_profile_prices` — the price surface for price
 *   sort and range (research R7), filled by the surface worker.
 *
 * Every foreign key reaches a table this module's manifest already depends on
 * (`catalog`, `customer_accounts`, `organizations`) or the kernel's
 * `sales_channels`, so `fk-dependency-drift` is unaffected.
 */

/** HY — contract first, blanket last (decision-record §5.6, owner ruling N11). */
const HY_CELLS = [
  'org.variant',
  'org.product',
  'org.category_attribute',
  'org.category',
  'org.attribute',
  'group.variant',
  'group.product',
  'group.category_attribute',
  'group.category',
  'group.attribute',
  'org.all',
  'group.all',
];

export class Migration20261021T165239PriceListsPriceBooksExpand extends Migration {
  override async up(): Promise<void> {
    // ---- 1. price_lists — the book header --------------------------------
    this.addSql(`alter table "price_lists" rename column "currency" to "currency_code";`);
    this.addSql(`alter table "price_lists" alter column "currency_code" type char(3);`);
    this.addSql(
      `alter table "price_lists" add column if not exists "audience_kind" varchar(16) not null default 'everyone';`,
    );
    this.addSql(`alter table "price_lists" drop constraint if exists "price_lists_audience_kind_check";`);
    this.addSql(
      `alter table "price_lists" add constraint "price_lists_audience_kind_check"
         check ("audience_kind" in ('everyone', 'customer_groups', 'organizations'));`,
    );
    this.addSql(`alter table "price_lists" drop constraint if exists "price_lists_type_check";`);
    this.addSql(
      `alter table "price_lists" add constraint "price_lists_type_check"
         check ("type" in ('base', 'regular', 'sale'));`,
    );
    // The default stays: a row inserted without a rule is still an old-model list.
    this.addSql(`alter table "price_lists" alter column "application_rule" drop not null;`);
    // One base book per currency replaces the one-system-list singleton.
    this.addSql(`drop index if exists "price_lists_is_system_unique";`);
    this.addSql(
      `create unique index if not exists "price_lists_system_currency_unique"
         on "price_lists" ("currency_code") where "is_system" = true;`,
    );
    this.addSql(
      `create index if not exists "price_lists_currency_status_idx" on "price_lists" ("currency_code", "status");`,
    );

    // ---- 2. the audience set ----------------------------------------------
    this.addSql(`create table if not exists "price_list_audience_members" (
      "id" uuid not null default gen_random_uuid(),
      "price_list_id" uuid not null,
      "organization_id" uuid null,
      "customer_group_id" uuid null,
      constraint "price_list_audience_members_pkey" primary key ("id"),
      constraint "price_list_audience_members_price_list_id_foreign"
        foreign key ("price_list_id") references "price_lists" ("id") on delete cascade,
      constraint "price_list_audience_members_organization_id_foreign"
        foreign key ("organization_id") references "organizations" ("id") on delete cascade,
      constraint "price_list_audience_members_customer_group_id_foreign"
        foreign key ("customer_group_id") references "customer_groups" ("id") on delete cascade,
      constraint "price_list_audience_members_one_member_check"
        check (("organization_id" is null) <> ("customer_group_id" is null))
    );`);
    this.addSql(
      `create unique index if not exists "price_list_audience_members_list_org_unique"
         on "price_list_audience_members" ("price_list_id", "organization_id") where "organization_id" is not null;`,
    );
    this.addSql(
      `create unique index if not exists "price_list_audience_members_list_group_unique"
         on "price_list_audience_members" ("price_list_id", "customer_group_id") where "customer_group_id" is not null;`,
    );
    this.addSql(
      `create index if not exists "price_list_audience_members_org_idx"
         on "price_list_audience_members" ("organization_id", "price_list_id") where "organization_id" is not null;`,
    );
    this.addSql(
      `create index if not exists "price_list_audience_members_group_idx"
         on "price_list_audience_members" ("customer_group_id", "price_list_id") where "customer_group_id" is not null;`,
    );

    // ---- 3. the channel set — a registered Principle XII bridge ------------
    this.addSql(`create table if not exists "sales_channel_price_lists" (
      "sales_channel_id" uuid not null,
      "price_list_id" uuid not null,
      constraint "sales_channel_price_lists_pkey" primary key ("sales_channel_id", "price_list_id"),
      constraint "sales_channel_price_lists_sales_channel_id_foreign"
        foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade,
      constraint "sales_channel_price_lists_price_list_id_foreign"
        foreign key ("price_list_id") references "price_lists" ("id") on delete cascade
    );`);
    this.addSql(
      `create index if not exists "sales_channel_price_lists_price_list_idx" on "sales_channel_price_lists" ("price_list_id");`,
    );

    // ---- 4. rows -----------------------------------------------------------
    this.addSql(`alter table "price_list_matrix_entries" add column if not exists "variant_id" uuid null;`);
    this.addSql(`alter table "price_list_matrix_entries" add column if not exists "percent" numeric(7,2) null;`);
    this.addSql(
      `alter table "price_list_matrix_entries" drop constraint if exists "price_list_matrix_entries_variant_id_foreign";`,
    );
    this.addSql(
      `alter table "price_list_matrix_entries" add constraint "price_list_matrix_entries_variant_id_foreign"
         foreign key ("variant_id") references "product_variants" ("id") on delete cascade;`,
    );
    // A product row needs no organization: the audience is the header's.
    this.addSql(
      `alter table "price_list_matrix_entries" drop constraint if exists "price_list_matrix_entries_product_organization_check";`,
    );
    this.addSql(
      `alter table "price_list_matrix_entries" drop constraint if exists "price_list_matrix_entries_variant_check";`,
    );
    this.addSql(
      `alter table "price_list_matrix_entries" add constraint "price_list_matrix_entries_variant_check"
         check ("variant_id" is null or ("product_id" is not null and "category_id" is null and "attribute_key" is null));`,
    );
    this.addSql(
      `alter table "price_list_matrix_entries" drop constraint if exists "price_list_matrix_entries_price_type_check";`,
    );
    this.addSql(
      `alter table "price_list_matrix_entries" add constraint "price_list_matrix_entries_price_type_check"
         check ("price_type" in ('fixed', 'percent', 'amount', 'discount_percent'));`,
    );
    this.addSql(
      `alter table "price_list_matrix_entries" drop constraint if exists "price_list_matrix_entries_price_check";`,
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
    this.addSql(
      `create index if not exists "price_list_matrix_entries_list_variant_idx"
         on "price_list_matrix_entries" ("price_list_id", "variant_id") where "variant_id" is not null;`,
    );
    this.addSql(
      `create index if not exists "price_list_matrix_entries_list_category_idx"
         on "price_list_matrix_entries" ("price_list_id", "category_id") where "category_id" is not null;`,
    );
    this.addSql(
      `create index if not exists "price_list_matrix_entries_list_attribute_idx"
         on "price_list_matrix_entries" ("price_list_id", "attribute_key", "attribute_value") where "attribute_key" is not null;`,
    );
    this.addSql(
      `create index if not exists "price_list_matrix_entries_variant_idx"
         on "price_list_matrix_entries" ("variant_id") where "variant_id" is not null;`,
    );
    this.addSql(
      `create index if not exists "price_list_matrix_entries_unit_amount_idx"
         on "price_list_matrix_entries" ("price_list_id", "amount", "product_id")
         where "min_quantity" = 1 and "variant_id" is null and "product_id" is not null and "price_type" = 'fixed';`,
    );

    // ---- 5. the precedence configuration, version 1 = HY -------------------
    this.addSql(`create table if not exists "price_list_precedence" (
      "version" integer not null,
      "cells" jsonb not null,
      "category_before_attribute" boolean not null,
      "depth_mode" varchar(32) not null,
      "state" varchar(16) not null,
      "impact" jsonb null,
      "created_by" uuid null,
      "created_at" timestamptz not null default now(),
      "activated_at" timestamptz null,
      constraint "price_list_precedence_pkey" primary key ("version"),
      constraint "price_list_precedence_depth_mode_check"
        check ("depth_mode" in ('within_cell', 'nearest_organization_first')),
      constraint "price_list_precedence_state_check"
        check ("state" in ('staged', 'active', 'superseded'))
    );`);
    this.addSql(
      `create unique index if not exists "price_list_precedence_one_active"
         on "price_list_precedence" ("state") where "state" = 'active';`,
    );
    this.addSql(
      `create unique index if not exists "price_list_precedence_one_staged"
         on "price_list_precedence" ("state") where "state" = 'staged';`,
    );
    this.addSql(
      `insert into "price_list_precedence"
         ("version", "cells", "category_before_attribute", "depth_mode", "state", "created_at", "activated_at")
       values (1, '${JSON.stringify(HY_CELLS)}'::jsonb, true, 'within_cell', 'active', now(), now())
       on conflict ("version") do nothing;`,
    );

    // ---- 6. the price surface ---------------------------------------------
    this.addSql(`create table if not exists "price_profiles" (
      "id" uuid not null,
      "sales_channel_id" uuid not null,
      "currency_code" char(3) not null,
      "precedence_version" integer not null,
      "key_hash" char(64) not null,
      "book_vector" jsonb not null,
      "uniform_percent" numeric(7,2) null,
      "state" varchar(16) not null,
      "built_at" timestamptz null,
      constraint "price_profiles_pkey" primary key ("id"),
      constraint "price_profiles_sales_channel_id_foreign"
        foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade,
      constraint "price_profiles_precedence_version_foreign"
        foreign key ("precedence_version") references "price_list_precedence" ("version"),
      constraint "price_profiles_state_check" check ("state" in ('building', 'ready'))
    );`);
    this.addSql(
      `create unique index if not exists "price_profiles_key_unique"
         on "price_profiles" ("sales_channel_id", "currency_code", "precedence_version", "key_hash");`,
    );
    this.addSql(`create table if not exists "price_profile_prices" (
      "profile_id" uuid not null,
      "product_id" uuid not null,
      "amount" numeric(14,4) not null,
      "max_amount" numeric(14,4) not null,
      "compare_at" numeric(14,4) null,
      "source_tier" varchar(16) not null,
      constraint "price_profile_prices_pkey" primary key ("profile_id", "product_id"),
      constraint "price_profile_prices_profile_id_foreign"
        foreign key ("profile_id") references "price_profiles" ("id") on delete cascade,
      constraint "price_profile_prices_product_id_foreign"
        foreign key ("product_id") references "products" ("id") on delete cascade,
      constraint "price_profile_prices_source_tier_check"
        check ("source_tier" in ('base', 'catalogue', 'buyer', 'sale'))
    );`);
    this.addSql(
      `create index if not exists "price_profile_prices_order_idx"
         on "price_profile_prices" ("profile_id", "amount", "product_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "price_profile_prices" cascade;`);
    this.addSql(`drop table if exists "price_profiles" cascade;`);
    this.addSql(`drop table if exists "price_list_precedence" cascade;`);
    this.addSql(`drop table if exists "sales_channel_price_lists" cascade;`);
    this.addSql(`drop table if exists "price_list_audience_members" cascade;`);

    // Rows of the price-book kinds cannot survive the old CHECKs.
    this.addSql(
      `delete from "price_list_matrix_entries"
        where "price_type" in ('percent', 'amount') or "variant_id" is not null
           or ("price_type" = 'fixed' and ("currency_code" is null or ("product_id" is not null and "organization_id" is null)));`,
    );
    this.addSql(`drop index if exists "price_list_matrix_entries_unit_amount_idx";`);
    this.addSql(`drop index if exists "price_list_matrix_entries_variant_idx";`);
    this.addSql(`drop index if exists "price_list_matrix_entries_list_attribute_idx";`);
    this.addSql(`drop index if exists "price_list_matrix_entries_list_category_idx";`);
    this.addSql(`drop index if exists "price_list_matrix_entries_list_variant_idx";`);
    for (const constraint of ['price_check', 'price_type_check', 'variant_check', 'variant_id_foreign']) {
      this.addSql(
        `alter table "price_list_matrix_entries" drop constraint if exists "price_list_matrix_entries_${constraint}";`,
      );
    }
    this.addSql(`alter table "price_list_matrix_entries" drop column if exists "percent";`);
    this.addSql(`alter table "price_list_matrix_entries" drop column if exists "variant_id";`);
    this.addSql(
      `alter table "price_list_matrix_entries" add constraint "price_list_matrix_entries_price_type_check"
         check ("price_type" in ('fixed', 'discount_percent'));`,
    );
    this.addSql(`alter table "price_list_matrix_entries" add constraint "price_list_matrix_entries_price_check" check (
      ("price_type" = 'fixed'
         and "amount" is not null and "amount" >= 0 and "currency_code" is not null
         and "discount_percent" is null
         and ("product_id" is not null or "category_id" is not null or "attribute_key" is not null))
      or
      ("price_type" = 'discount_percent'
         and "discount_percent" > 0 and "discount_percent" <= 100
         and "amount" is null and "currency_code" is null)
    );`);
    this.addSql(
      `alter table "price_list_matrix_entries" add constraint "price_list_matrix_entries_product_organization_check"
         check ("product_id" is null or "organization_id" is not null);`,
    );

    // Price books carry no rule; the old engine cannot read them.
    this.addSql(`delete from "price_lists" where "application_rule" is null and not "is_system";`);
    this.addSql(`update "price_lists" set "application_rule" = '{"kind":"all"}'::jsonb where "application_rule" is null;`);
    this.addSql(`alter table "price_lists" alter column "application_rule" set not null;`);
    this.addSql(`update "price_lists" set "type" = 'base' where "type" = 'regular';`);
    this.addSql(`alter table "price_lists" drop constraint if exists "price_lists_type_check";`);
    this.addSql(`alter table "price_lists" add constraint "price_lists_type_check" check ("type" in ('base','sale'));`);
    this.addSql(`drop index if exists "price_lists_currency_status_idx";`);
    this.addSql(`drop index if exists "price_lists_system_currency_unique";`);
    // Back to one system list: keep the canonical Default row, as the singleton migration does.
    this.addSql(
      `update "price_lists" set "is_system" = false
        where "is_system" = true and "id" <> (
          select "id" from "price_lists" where "is_system" = true
           order by ("id" = '00000000-0000-4000-8000-00000000d51b') desc, "created_at" asc, "id" asc limit 1);`,
    );
    this.addSql(
      `create unique index if not exists "price_lists_is_system_unique" on "price_lists" ("is_system") where "is_system" = true;`,
    );
    this.addSql(`alter table "price_lists" drop constraint if exists "price_lists_audience_kind_check";`);
    this.addSql(`alter table "price_lists" drop column if exists "audience_kind";`);
    this.addSql(`alter table "price_lists" alter column "currency_code" type varchar(3);`);
    this.addSql(`alter table "price_lists" rename column "currency_code" to "currency";`);
  }
}
