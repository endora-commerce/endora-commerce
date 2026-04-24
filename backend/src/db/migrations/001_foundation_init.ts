import { Migration } from '@mikro-orm/migrations';

/**
 * Initial foundation migration — consolidates Phase 2 (sessions, audit_log_entries)
 * and Phase 3.4 catalog / assets / inventory tables, plus the M:N bridge tables the
 * Catalog module needs for category membership, asset attachment, and Sales Channel
 * visibility.
 *
 * Naming follows Principle VI:
 *   - Plural snake_case table names.
 *   - snake_case columns.
 *   - Foreign-key columns named `{singular}_id`.
 *   - Bridge tables named by joining the two singulars alphabetically
 *     (e.g. `product_categories` for product ↔ category).
 *
 * Generated from entity metadata and then enriched with bridges. Kept in
 * `src/db/migrations/` (module-agnostic) because it spans several modules.
 */
export class Migration001FoundationInit extends Migration {
  override async up(): Promise<void> {
    // --- Phase 2: auth + audit_logs ----------------------------------------
    this.addSql(`
      create table "sessions" (
        "id" uuid not null,
        "token_hash" varchar(128) not null,
        "customer_account_id" uuid null,
        "admin_user_id" uuid null,
        "impersonator_admin_user_id" uuid null,
        "expires_at" timestamptz not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "last_seen_at" timestamptz null,
        "ip_address" varchar(45) null,
        "user_agent" varchar(255) null,
        constraint "sessions_pkey" primary key ("id")
      );
    `);
    this.addSql('create index "sessions_token_hash_index" on "sessions" ("token_hash");');
    this.addSql('create index "sessions_customer_account_id_index" on "sessions" ("customer_account_id");');
    this.addSql('create index "sessions_admin_user_id_index" on "sessions" ("admin_user_id");');
    this.addSql('create index "sessions_expires_at_index" on "sessions" ("expires_at");');

    this.addSql(`
      create table "audit_log_entries" (
        "id" uuid not null,
        "actor_admin_user_id" uuid null,
        "impersonated_customer_account_id" uuid null,
        "acted_at" timestamptz not null,
        "action" varchar(120) not null,
        "object_type" varchar(120) not null,
        "object_id" varchar(120) not null,
        "state_before" jsonb null,
        "state_after" jsonb null,
        "ip_address" varchar(45) null,
        "user_agent" varchar(255) null,
        "request_id" varchar(64) null,
        constraint "audit_log_entries_pkey" primary key ("id")
      );
    `);
    this.addSql('create index "audit_log_entries_actor_admin_user_id_index" on "audit_log_entries" ("actor_admin_user_id");');
    this.addSql('create index "audit_log_entries_impersonated_customer_account_id_index" on "audit_log_entries" ("impersonated_customer_account_id");');
    this.addSql('create index "audit_log_entries_acted_at_index" on "audit_log_entries" ("acted_at");');
    this.addSql('create index "audit_log_entries_action_index" on "audit_log_entries" ("action");');
    this.addSql('create index "audit_log_entries_object_id_index" on "audit_log_entries" ("object_id");');

    // --- Phase 3.4: assets -------------------------------------------------
    this.addSql(`
      create table "assets" (
        "id" uuid not null,
        "kind" varchar(16) not null,
        "filename" varchar(255) not null,
        "mime_type" varchar(127) not null,
        "size_bytes" bigint not null,
        "storage_url" varchar(2048) not null,
        "alt_text" jsonb null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "assets_pkey" primary key ("id")
      );
    `);
    this.addSql('create index "assets_kind_index" on "assets" ("kind");');

    // --- Phase 3.4: catalog (sales_channels, categories, products,
    //                         product_variants, product_attributes) --------
    this.addSql(`
      create table "sales_channels" (
        "id" uuid not null,
        "code" varchar(32) not null,
        "name" jsonb not null,
        "is_public" boolean not null default false,
        "default_language" varchar(10) not null,
        "default_currency" varchar(3) not null,
        "status" varchar(16) not null default 'active',
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "sales_channels_pkey" primary key ("id"),
        constraint "sales_channels_code_unique" unique ("code")
      );
    `);

    this.addSql(`
      create table "categories" (
        "id" uuid not null,
        "parent_category_id" uuid null,
        "name" jsonb not null,
        "slug" varchar(160) not null,
        "sort_order" int not null default 0,
        "meta_title_override" jsonb null,
        "meta_description_override" jsonb null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "categories_pkey" primary key ("id"),
        constraint "categories_parent_fk" foreign key ("parent_category_id") references "categories" ("id") on delete restrict
      );
    `);
    this.addSql('create index "categories_parent_category_id_index" on "categories" ("parent_category_id");');
    this.addSql('create index "categories_slug_index" on "categories" ("slug");');
    // Slug unique per parent (treat root parents as the synthetic zero-uuid for the unique constraint purpose).
    this.addSql(
      `create unique index "categories_parent_slug_unique" on "categories" (coalesce("parent_category_id", '00000000-0000-0000-0000-000000000000'::uuid), "slug") where "deleted_at" is null;`,
    );

    this.addSql(`
      create table "products" (
        "id" uuid not null,
        "sku" varchar(64) not null,
        "slug" varchar(160) not null,
        "type" varchar(16) not null,
        "status" varchar(16) not null default 'draft',
        "name" jsonb not null,
        "description" jsonb not null,
        "stock_mode" varchar(16) null,
        "visibility" varchar(32) not null default 'public',
        "attribute_values" jsonb not null default '{}'::jsonb,
        "allowed_organization_ids" jsonb not null default '[]'::jsonb,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "archived_at" timestamptz null,
        "deleted_at" timestamptz null,
        constraint "products_pkey" primary key ("id"),
        constraint "products_sku_unique" unique ("sku"),
        constraint "products_slug_unique" unique ("slug")
      );
    `);
    this.addSql('create index "products_slug_index" on "products" ("slug");');
    this.addSql('create index "products_status_index" on "products" ("status");');
    this.addSql('create index "products_created_at_index" on "products" ("created_at");');
    this.addSql('create index "products_updated_at_index" on "products" ("updated_at");');
    this.addSql('create index "products_archived_at_index" on "products" ("archived_at");');

    this.addSql(`
      create table "product_variants" (
        "id" uuid not null,
        "parent_product_id" uuid not null,
        "sku" varchar(64) not null,
        "variant_attribute_values" jsonb not null default '{}'::jsonb,
        "price_override" numeric(12,2) null,
        "stock_level" int null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "product_variants_pkey" primary key ("id"),
        constraint "product_variants_sku_unique" unique ("sku"),
        constraint "product_variants_parent_fk" foreign key ("parent_product_id") references "products" ("id") on delete cascade
      );
    `);
    this.addSql('create index "product_variants_parent_product_id_index" on "product_variants" ("parent_product_id");');

    this.addSql(`
      create table "product_attributes" (
        "id" uuid not null,
        "key" varchar(64) not null,
        "label" jsonb not null,
        "value_type" varchar(16) not null,
        "enum_values" jsonb null,
        "is_searchable" boolean not null default false,
        "is_filterable" boolean not null default false,
        "is_variant_axis" boolean not null default false,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "product_attributes_pkey" primary key ("id"),
        constraint "product_attributes_key_unique" unique ("key")
      );
    `);

    // --- Phase 3.4: inventory ---------------------------------------------
    this.addSql(`
      create table "availability_notifications" (
        "id" uuid not null,
        "customer_account_id" uuid not null,
        "product_id" uuid not null,
        "variant_id" uuid null,
        "requested_at" timestamptz not null,
        "notified_at" timestamptz null,
        constraint "availability_notifications_pkey" primary key ("id")
      );
    `);
    this.addSql('create index "availability_notifications_customer_account_id_index" on "availability_notifications" ("customer_account_id");');
    this.addSql('create index "availability_notifications_product_id_index" on "availability_notifications" ("product_id");');

    // --- M:N bridges for the catalog module -------------------------------
    // Product ↔ Category — Products belong to zero-or-more Categories.
    this.addSql(`
      create table "product_categories" (
        "product_id" uuid not null,
        "category_id" uuid not null,
        constraint "product_categories_pkey" primary key ("product_id", "category_id"),
        constraint "product_categories_product_fk" foreign key ("product_id") references "products" ("id") on delete cascade,
        constraint "product_categories_category_fk" foreign key ("category_id") references "categories" ("id") on delete restrict
      );
    `);
    this.addSql('create index "product_categories_category_id_index" on "product_categories" ("category_id");');

    // Product ↔ Asset — Assets attached to a Product in an explicit order.
    this.addSql(`
      create table "product_assets" (
        "product_id" uuid not null,
        "asset_id" uuid not null,
        "position" int not null default 0,
        constraint "product_assets_pkey" primary key ("product_id", "asset_id"),
        constraint "product_assets_product_fk" foreign key ("product_id") references "products" ("id") on delete cascade,
        constraint "product_assets_asset_fk" foreign key ("asset_id") references "assets" ("id") on delete cascade
      );
    `);
    this.addSql('create index "product_assets_asset_id_index" on "product_assets" ("asset_id");');
    this.addSql('create index "product_assets_product_id_position_index" on "product_assets" ("product_id", "position");');

    // SalesChannel ↔ Product — the subset of the catalog visible in a channel.
    this.addSql(`
      create table "sales_channel_products" (
        "sales_channel_id" uuid not null,
        "product_id" uuid not null,
        constraint "sales_channel_products_pkey" primary key ("sales_channel_id", "product_id"),
        constraint "sales_channel_products_sales_channel_fk" foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade,
        constraint "sales_channel_products_product_fk" foreign key ("product_id") references "products" ("id") on delete cascade
      );
    `);
    this.addSql('create index "sales_channel_products_product_id_index" on "sales_channel_products" ("product_id");');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "sales_channel_products" cascade;');
    this.addSql('drop table if exists "product_assets" cascade;');
    this.addSql('drop table if exists "product_categories" cascade;');
    this.addSql('drop table if exists "availability_notifications" cascade;');
    this.addSql('drop table if exists "product_attributes" cascade;');
    this.addSql('drop table if exists "product_variants" cascade;');
    this.addSql('drop table if exists "products" cascade;');
    this.addSql('drop table if exists "categories" cascade;');
    this.addSql('drop table if exists "sales_channels" cascade;');
    this.addSql('drop table if exists "assets" cascade;');
    this.addSql('drop table if exists "audit_log_entries" cascade;');
    this.addSql('drop table if exists "sessions" cascade;');
  }
}
