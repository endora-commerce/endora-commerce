import { Migration } from '@mikro-orm/migrations';

/**
 * Sales Channels module — feature 005 / data-model.md.
 *
 * The `sales_channels` table itself was created back in foundation 001;
 * this migration promotes it from a thin catalog-owned record into the
 * full Sales-Channel registry the spec describes:
 *
 *   - Adds the missing identity columns (`logo_asset_id`, `theme_code`,
 *     `languages` jsonb, `currencies` jsonb, `active`, `system_default`,
 *     `version`) and the partial unique index that enforces the
 *     "exactly-one system default" invariant (FR-002).
 *   - Backfills the new jsonb arrays from the existing scalar
 *     `default_language` / `default_currency` columns and copies
 *     `status='active'` into the new boolean `active` flag.
 *   - Creates eight new M:N bridge tables (FR-009): categories,
 *     payment_methods, delivery_methods, organizations, taxes,
 *     customer_accounts, promotions, cms_pages.
 *   - Adds a NULLABLE `sales_channel_id` column to `quote_requests`
 *     with `ON DELETE RESTRICT` (FR-006). The column stays NULLABLE
 *     in this migration; T060 (US3) ships a follow-up data-migration
 *     script that backfills every NULL row with the system-default
 *     channel and then flips the column to NOT NULL. This two-step
 *     approach keeps migration 025 reversible and lets the boot-time
 *     reconciler (R-4) be the single source of truth for the existence
 *     of the system-default channel rather than baking that logic into
 *     two places.
 *
 * Deferred (intentionally NOT in this migration):
 *
 *   - `sales_channel_inventory_locations` — the inventory module does
 *     not yet have an `inventory_locations` table. The bridge will be
 *     added in the same migration that introduces that table; until
 *     then, FR-009's "Inventory" item is unimplemented and is tracked
 *     by tasks.md T054 / data-model.md § Entities note.
 *   - The legacy `is_public` and `status` columns are kept as-is for
 *     one release cycle (R-12) so this migration is fully reversible.
 *     A later cleanup migration will drop them once every consumer has
 *     moved to `active`.
 *   - Inserting / promoting the `Default` row — the boot-time
 *     reconciler (`default-channel-reconciler.ts`) is the single source
 *     of truth (R-4).
 *
 * The down() reverses every up() step; the legacy columns are not
 * touched.
 */
export class Migration20260430T170044SalesChannelsPromote extends Migration {
  override async up(): Promise<void> {
    // -- 1. Identity columns ------------------------------------------------
    this.addSql(
      'alter table "sales_channels" add column "logo_asset_id" uuid null;',
    );
    this.addSql(
      'alter table "sales_channels" add constraint "sales_channels_logo_asset_fk" ' +
        'foreign key ("logo_asset_id") references "assets" ("id") on delete set null;',
    );
    this.addSql(
      'alter table "sales_channels" add column "theme_code" varchar(64) null;',
    );
    this.addSql(
      'alter table "sales_channels" add column "languages" jsonb not null default \'[]\'::jsonb;',
    );
    this.addSql(
      'alter table "sales_channels" add column "currencies" jsonb not null default \'[]\'::jsonb;',
    );
    this.addSql(
      'alter table "sales_channels" add column "active" boolean not null default true;',
    );
    this.addSql(
      'alter table "sales_channels" add column "system_default" boolean not null default false;',
    );
    this.addSql(
      'alter table "sales_channels" add column "version" int not null default 1;',
    );

    // -- 2. Backfills (data-only; safe and idempotent) ----------------------
    // Seed the new jsonb arrays from the existing scalar defaults.
    this.addSql(
      'update "sales_channels" set "languages" = jsonb_build_array("default_language") ' +
        "where jsonb_array_length(\"languages\") = 0;",
    );
    this.addSql(
      'update "sales_channels" set "currencies" = jsonb_build_array("default_currency") ' +
        "where jsonb_array_length(\"currencies\") = 0;",
    );
    // Mirror legacy `status='active'` into the new boolean.
    this.addSql(
      "update \"sales_channels\" set \"active\" = (\"status\" = 'active');",
    );

    // -- 3. Partial unique index (FR-002) -----------------------------------
    this.addSql(
      'create unique index "sales_channels_one_system_default" ' +
        'on "sales_channels" ("system_default") where "system_default" = true;',
    );

    // -- 4. M:N bridge tables (FR-009) --------------------------------------
    // categories
    this.addSql(`
      create table "sales_channel_categories" (
        "sales_channel_id" uuid not null,
        "category_id" uuid not null,
        constraint "sales_channel_categories_pkey"
          primary key ("sales_channel_id", "category_id"),
        constraint "sales_channel_categories_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade,
        constraint "sales_channel_categories_category_fk"
          foreign key ("category_id") references "categories" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index "sales_channel_categories_category_id_index" ' +
        'on "sales_channel_categories" ("category_id");',
    );

    // payment_methods
    this.addSql(`
      create table "sales_channel_payment_methods" (
        "sales_channel_id" uuid not null,
        "payment_method_id" uuid not null,
        constraint "sales_channel_payment_methods_pkey"
          primary key ("sales_channel_id", "payment_method_id"),
        constraint "sales_channel_payment_methods_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade,
        constraint "sales_channel_payment_methods_payment_method_fk"
          foreign key ("payment_method_id") references "payment_methods" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index "sales_channel_payment_methods_payment_method_id_index" ' +
        'on "sales_channel_payment_methods" ("payment_method_id");',
    );

    // delivery_methods
    this.addSql(`
      create table "sales_channel_delivery_methods" (
        "sales_channel_id" uuid not null,
        "delivery_method_id" uuid not null,
        constraint "sales_channel_delivery_methods_pkey"
          primary key ("sales_channel_id", "delivery_method_id"),
        constraint "sales_channel_delivery_methods_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade,
        constraint "sales_channel_delivery_methods_delivery_method_fk"
          foreign key ("delivery_method_id") references "delivery_methods" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index "sales_channel_delivery_methods_delivery_method_id_index" ' +
        'on "sales_channel_delivery_methods" ("delivery_method_id");',
    );

    // organizations
    this.addSql(`
      create table "sales_channel_organizations" (
        "sales_channel_id" uuid not null,
        "organization_id" uuid not null,
        constraint "sales_channel_organizations_pkey"
          primary key ("sales_channel_id", "organization_id"),
        constraint "sales_channel_organizations_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade,
        constraint "sales_channel_organizations_organization_fk"
          foreign key ("organization_id") references "organizations" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index "sales_channel_organizations_organization_id_index" ' +
        'on "sales_channel_organizations" ("organization_id");',
    );

    // taxes
    this.addSql(`
      create table "sales_channel_taxes" (
        "sales_channel_id" uuid not null,
        "tax_id" uuid not null,
        constraint "sales_channel_taxes_pkey"
          primary key ("sales_channel_id", "tax_id"),
        constraint "sales_channel_taxes_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade,
        constraint "sales_channel_taxes_tax_fk"
          foreign key ("tax_id") references "taxes" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index "sales_channel_taxes_tax_id_index" ' +
        'on "sales_channel_taxes" ("tax_id");',
    );

    // customer_accounts
    this.addSql(`
      create table "sales_channel_customer_accounts" (
        "sales_channel_id" uuid not null,
        "customer_account_id" uuid not null,
        constraint "sales_channel_customer_accounts_pkey"
          primary key ("sales_channel_id", "customer_account_id"),
        constraint "sales_channel_customer_accounts_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade,
        constraint "sales_channel_customer_accounts_customer_account_fk"
          foreign key ("customer_account_id") references "customer_accounts" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index "sales_channel_customer_accounts_customer_account_id_index" ' +
        'on "sales_channel_customer_accounts" ("customer_account_id");',
    );

    // promotions
    this.addSql(`
      create table "sales_channel_promotions" (
        "sales_channel_id" uuid not null,
        "promotion_id" uuid not null,
        constraint "sales_channel_promotions_pkey"
          primary key ("sales_channel_id", "promotion_id"),
        constraint "sales_channel_promotions_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade,
        constraint "sales_channel_promotions_promotion_fk"
          foreign key ("promotion_id") references "promotions" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index "sales_channel_promotions_promotion_id_index" ' +
        'on "sales_channel_promotions" ("promotion_id");',
    );

    // cms_pages
    this.addSql(`
      create table "sales_channel_cms_pages" (
        "sales_channel_id" uuid not null,
        "cms_page_id" uuid not null,
        constraint "sales_channel_cms_pages_pkey"
          primary key ("sales_channel_id", "cms_page_id"),
        constraint "sales_channel_cms_pages_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade,
        constraint "sales_channel_cms_pages_cms_page_fk"
          foreign key ("cms_page_id") references "cms_pages" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index "sales_channel_cms_pages_cms_page_id_index" ' +
        'on "sales_channel_cms_pages" ("cms_page_id");',
    );

    // -- 5. Quote-request channel attribution (FR-012) ----------------------
    // NULLABLE in this migration; T060 backfills + flips NOT NULL.
    this.addSql(
      'alter table "quote_requests" add column "sales_channel_id" uuid null;',
    );
    this.addSql(
      'alter table "quote_requests" add constraint "quote_requests_sales_channel_fk" ' +
        'foreign key ("sales_channel_id") references "sales_channels" ("id") ' +
        'on delete restrict;',
    );
    this.addSql(
      'create index "quote_requests_sales_channel_id_index" ' +
        'on "quote_requests" ("sales_channel_id");',
    );
  }

  override async down(): Promise<void> {
    // 5. Quote-request column
    this.addSql('drop index if exists "quote_requests_sales_channel_id_index";');
    this.addSql(
      'alter table "quote_requests" drop constraint if exists "quote_requests_sales_channel_fk";',
    );
    this.addSql('alter table "quote_requests" drop column if exists "sales_channel_id";');

    // 4. Bridge tables (cascading reverse order)
    this.addSql('drop table if exists "sales_channel_cms_pages" cascade;');
    this.addSql('drop table if exists "sales_channel_promotions" cascade;');
    this.addSql('drop table if exists "sales_channel_customer_accounts" cascade;');
    this.addSql('drop table if exists "sales_channel_taxes" cascade;');
    this.addSql('drop table if exists "sales_channel_organizations" cascade;');
    this.addSql('drop table if exists "sales_channel_delivery_methods" cascade;');
    this.addSql('drop table if exists "sales_channel_payment_methods" cascade;');
    this.addSql('drop table if exists "sales_channel_categories" cascade;');

    // 3. Partial unique index
    this.addSql('drop index if exists "sales_channels_one_system_default";');

    // 1. Identity columns
    this.addSql('alter table "sales_channels" drop column if exists "version";');
    this.addSql('alter table "sales_channels" drop column if exists "system_default";');
    this.addSql('alter table "sales_channels" drop column if exists "active";');
    this.addSql('alter table "sales_channels" drop column if exists "currencies";');
    this.addSql('alter table "sales_channels" drop column if exists "languages";');
    this.addSql('alter table "sales_channels" drop column if exists "theme_code";');
    this.addSql(
      'alter table "sales_channels" drop constraint if exists "sales_channels_logo_asset_fk";',
    );
    this.addSql('alter table "sales_channels" drop column if exists "logo_asset_id";');
  }
}
