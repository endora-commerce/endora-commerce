import { Migration } from '@mikro-orm/migrations';

/**
 * Blog module — feature 016 / data-model.md.
 *
 * Schema changes (one atomic migration):
 *   - new tables: blog_categories + blog_category_sales_channels +
 *     blog_category_languages + blog_posts + blog_post_sales_channels +
 *     blog_post_languages + blog_post_categories + blog_post_tags +
 *     blog_post_related_posts + blog_post_related_products + blog_tags.
 *   - GIN index on blog_posts.content (jsonb_path_ops) so the asset-reference
 *     scan stays fast (R13).
 *   - btree index on blog_posts(status, published_at DESC) drives the
 *     storefront's "newest first" listing.
 *   - btree index on blog_categories(parent_id, position) drives the
 *     per-tree fetch.
 *   - PARTIAL unique indexes on blog_post_sales_channels(sales_channel_id,
 *     slug) WHERE deleted_at IS NULL and the analogous one on
 *     blog_category_sales_channels — defensive guards for the cross-table
 *     uniqueness contract documented in research.md § R3 (the cross-table
 *     check itself runs at the service layer with a pg_advisory_xact_lock).
 *   - PARTIAL unique on blog_tags(code) WHERE deleted_at IS NULL — global
 *     tag-code uniqueness (R14).
 *
 * No seed rows; the seeded `Default` Category and the two seeded admin
 * roles are inserted by runtime reconcilers in `services/seed-default-
 * category.ts` and `services/seed-roles.ts` so admin edits across deploys
 * stay safe (R8 + R11).
 */
export class Migration20260506T081055BlogInit extends Migration {
  override async up(): Promise<void> {
    // ────────────────────────────────────────────────────────────────────
    // 1) blog_categories — adjacency-list tree
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "blog_categories" (
        "id" uuid not null,
        "parent_id" uuid null,
        "position" int not null default 0,
        "name" jsonb not null default '{}'::jsonb,
        "slug" varchar(160) not null,
        "enabled" boolean not null default true,
        "description" jsonb null,
        "main_image_asset_id" uuid null,
        "meta_title" jsonb null,
        "meta_description" jsonb null,
        "meta_keywords" jsonb null,
        "is_system" boolean not null default false,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "blog_categories_pkey" primary key ("id"),
        constraint "blog_categories_parent_fk" foreign key ("parent_id")
          references "blog_categories" ("id") on delete no action,
        constraint "blog_categories_main_image_fk" foreign key ("main_image_asset_id")
          references "assets" ("id") on delete no action
      );
    `);
    this.addSql(
      'create index "idx_blog_categories_parent_position" on "blog_categories" ("parent_id", "position");',
    );
    this.addSql(
      'create index "idx_blog_categories_main_image_asset" on "blog_categories" ("main_image_asset_id");',
    );
    this.addSql(
      'create index "idx_blog_categories_is_system" on "blog_categories" ("is_system");',
    );
    this.addSql(
      'create index "idx_blog_categories_deleted_at" on "blog_categories" ("deleted_at");',
    );

    // ────────────────────────────────────────────────────────────────────
    // 2) blog_category_sales_channels (M2M + denormalised slug + deleted_at)
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "blog_category_sales_channels" (
        "blog_category_id" uuid not null,
        "sales_channel_id" uuid not null,
        "slug" varchar(160) not null,
        "deleted_at" timestamptz null,
        constraint "blog_category_sales_channels_pkey"
          primary key ("blog_category_id", "sales_channel_id"),
        constraint "blog_category_sales_channels_category_fk" foreign key ("blog_category_id")
          references "blog_categories" ("id") on delete cascade,
        constraint "blog_category_sales_channels_channel_fk" foreign key ("sales_channel_id")
          references "sales_channels" ("id") on delete cascade
      );
    `);
    this.addSql(
      `create unique index "idx_blog_categories_slug_per_channel_uniq"
         on "blog_category_sales_channels" ("sales_channel_id", "slug")
         where "deleted_at" is null;`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 3) blog_category_languages (M2M)
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "blog_category_languages" (
        "blog_category_id" uuid not null,
        "language" varchar(8) not null,
        constraint "blog_category_languages_pkey"
          primary key ("blog_category_id", "language"),
        constraint "blog_category_languages_category_fk" foreign key ("blog_category_id")
          references "blog_categories" ("id") on delete cascade
      );
    `);

    // ────────────────────────────────────────────────────────────────────
    // 4) blog_posts
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "blog_posts" (
        "id" uuid not null,
        "name" jsonb not null default '{}'::jsonb,
        "slug" varchar(160) not null,
        "active" boolean not null default true,
        "status" varchar(16) not null default 'draft',
        "published_at" timestamptz null,
        "description" text null,
        "meta_title" jsonb null,
        "meta_description" jsonb null,
        "meta_keywords" jsonb null,
        "content" jsonb not null default '{}'::jsonb,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "blog_posts_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "idx_blog_posts_status_published_at"
         on "blog_posts" ("status", "published_at" desc);`,
    );
    this.addSql(
      'create index "idx_blog_posts_deleted_at" on "blog_posts" ("deleted_at");',
    );
    this.addSql(
      `create index "idx_blog_posts_content_refs"
         on "blog_posts" using gin ("content" jsonb_path_ops);`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 5) blog_post_sales_channels (M2M + denormalised slug + deleted_at)
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "blog_post_sales_channels" (
        "blog_post_id" uuid not null,
        "sales_channel_id" uuid not null,
        "slug" varchar(160) not null,
        "deleted_at" timestamptz null,
        constraint "blog_post_sales_channels_pkey"
          primary key ("blog_post_id", "sales_channel_id"),
        constraint "blog_post_sales_channels_post_fk" foreign key ("blog_post_id")
          references "blog_posts" ("id") on delete cascade,
        constraint "blog_post_sales_channels_channel_fk" foreign key ("sales_channel_id")
          references "sales_channels" ("id") on delete cascade
      );
    `);
    this.addSql(
      `create unique index "idx_blog_posts_slug_per_channel_uniq"
         on "blog_post_sales_channels" ("sales_channel_id", "slug")
         where "deleted_at" is null;`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 6) blog_post_languages (M2M)
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "blog_post_languages" (
        "blog_post_id" uuid not null,
        "language" varchar(8) not null,
        constraint "blog_post_languages_pkey"
          primary key ("blog_post_id", "language"),
        constraint "blog_post_languages_post_fk" foreign key ("blog_post_id")
          references "blog_posts" ("id") on delete cascade
      );
    `);

    // ────────────────────────────────────────────────────────────────────
    // 7) blog_post_categories (M2M)
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "blog_post_categories" (
        "blog_post_id" uuid not null,
        "blog_category_id" uuid not null,
        constraint "blog_post_categories_pkey"
          primary key ("blog_post_id", "blog_category_id"),
        constraint "blog_post_categories_post_fk" foreign key ("blog_post_id")
          references "blog_posts" ("id") on delete cascade,
        constraint "blog_post_categories_category_fk" foreign key ("blog_category_id")
          references "blog_categories" ("id") on delete no action
      );
    `);
    this.addSql(
      `create index "idx_blog_post_categories_category_id"
         on "blog_post_categories" ("blog_category_id");`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 8) blog_tags
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "blog_tags" (
        "id" uuid not null,
        "name" jsonb not null default '{}'::jsonb,
        "description" jsonb null,
        "code" varchar(64) not null,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "blog_tags_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create unique index "idx_blog_tags_code_uniq"
         on "blog_tags" ("code")
         where "deleted_at" is null;`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 9) blog_post_tags (M2M, ordered)
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "blog_post_tags" (
        "blog_post_id" uuid not null,
        "blog_tag_id" uuid not null,
        "position" int not null default 0,
        constraint "blog_post_tags_pkey"
          primary key ("blog_post_id", "blog_tag_id"),
        constraint "blog_post_tags_post_fk" foreign key ("blog_post_id")
          references "blog_posts" ("id") on delete cascade,
        constraint "blog_post_tags_tag_fk" foreign key ("blog_tag_id")
          references "blog_tags" ("id") on delete no action
      );
    `);
    this.addSql(
      `create index "idx_blog_post_tags_tag_id"
         on "blog_post_tags" ("blog_tag_id");`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 10) blog_post_related_posts (self-join, ordered)
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "blog_post_related_posts" (
        "parent_post_id" uuid not null,
        "related_post_id" uuid not null,
        "position" int not null default 0,
        constraint "blog_post_related_posts_pkey"
          primary key ("parent_post_id", "related_post_id"),
        constraint "blog_post_related_posts_parent_fk" foreign key ("parent_post_id")
          references "blog_posts" ("id") on delete cascade,
        constraint "blog_post_related_posts_related_fk" foreign key ("related_post_id")
          references "blog_posts" ("id") on delete no action
      );
    `);
    this.addSql(
      `create index "idx_blog_post_related_posts_related"
         on "blog_post_related_posts" ("related_post_id");`,
    );

    // ────────────────────────────────────────────────────────────────────
    // 11) blog_post_related_products (M2M to products, ordered)
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "blog_post_related_products" (
        "blog_post_id" uuid not null,
        "product_id" uuid not null,
        "position" int not null default 0,
        constraint "blog_post_related_products_pkey"
          primary key ("blog_post_id", "product_id"),
        constraint "blog_post_related_products_post_fk" foreign key ("blog_post_id")
          references "blog_posts" ("id") on delete cascade,
        constraint "blog_post_related_products_product_fk" foreign key ("product_id")
          references "products" ("id") on delete no action
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "blog_post_related_products" cascade;');
    this.addSql('drop table if exists "blog_post_related_posts" cascade;');
    this.addSql('drop table if exists "blog_post_tags" cascade;');
    this.addSql('drop table if exists "blog_tags" cascade;');
    this.addSql('drop table if exists "blog_post_categories" cascade;');
    this.addSql('drop table if exists "blog_post_languages" cascade;');
    this.addSql('drop table if exists "blog_post_sales_channels" cascade;');
    this.addSql('drop table if exists "blog_posts" cascade;');
    this.addSql('drop table if exists "blog_category_languages" cascade;');
    this.addSql('drop table if exists "blog_category_sales_channels" cascade;');
    this.addSql('drop table if exists "blog_categories" cascade;');
  }
}
