import { Migration } from '@mikro-orm/migrations';

/**
 * Assets Library — feature 013 / data-model.md.
 *
 * Schema changes:
 *   - new `asset_folders` table (organisational tree for the Library page).
 *   - eight new columns on the existing `assets` table:
 *       folder_id, visibility, label, storage_backend, storage_locator,
 *       pending_cleanup, purge_after_at, mime_type_overridden.
 *   - new `categories.main_image_asset_id` FK column.
 *   - GIN index on `cms_pages.body` so reference-protection's JSONB-path
 *     scan stays fast (research R10).
 *
 * Backfill:
 *   - every pre-existing assets row is mapped to storage_backend='local'
 *     with storage_locator=storage_url.
 *   - rows whose pre-013 storage_url is an absolute URL are tagged
 *     storage_backend='legacy' (read-only escape hatch — research R11).
 *
 * The legacy `storage_url` column is left in place for one release; new
 * code reads `storage_locator` exclusively.
 */
export class Migration034AssetsLibraryInit extends Migration {
  override async up(): Promise<void> {
    // --- asset_folders ---------------------------------------------------
    this.addSql(`
      create table "asset_folders" (
        "id" uuid not null,
        "parent_id" uuid null,
        "name" varchar(160) not null,
        "position" integer not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "asset_folders_pkey" primary key ("id"),
        constraint "asset_folders_parent_fk" foreign key ("parent_id")
          references "asset_folders" ("id") on delete restrict,
        constraint "asset_folders_no_self_parent" check ("id" <> "parent_id")
      );
    `);
    this.addSql(
      'create index "asset_folders_parent_position_index" on "asset_folders" ("parent_id", "position");',
    );
    // Case-insensitive uniqueness of (parent_id, name). NULL parent_id is
    // coalesced to the all-zero UUID so the constraint also covers root.
    this.addSql(`
      create unique index "asset_folders_unique_name_per_parent"
        on "asset_folders" (
          coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),
          lower("name")
        );
    `);

    // --- assets: extended columns ----------------------------------------
    this.addSql(`alter table "assets"
      add column "folder_id" uuid null,
      add column "visibility" varchar(7) not null default 'public',
      add column "label" text null,
      add column "storage_backend" varchar(8) not null default 'local',
      add column "storage_locator" varchar(2048) not null default '',
      add column "pending_cleanup" boolean not null default false,
      add column "purge_after_at" timestamptz null,
      add column "mime_type_overridden" boolean not null default false;
    `);
    this.addSql(`
      alter table "assets"
        add constraint "assets_folder_fk" foreign key ("folder_id")
          references "asset_folders" ("id") on delete set null,
        add constraint "assets_visibility_check"
          check ("visibility" in ('public','private')),
        add constraint "assets_storage_backend_check"
          check ("storage_backend" in ('local','s3','gcs','legacy'));
    `);
    this.addSql(
      'create index "assets_folder_visible_index" on "assets" ("folder_id", "deleted_at", "created_at" desc);',
    );
    this.addSql(
      'create index "assets_pending_cleanup_index" on "assets" ("pending_cleanup") where "pending_cleanup" = true;',
    );
    this.addSql(
      'create index "assets_purge_due_index" on "assets" ("purge_after_at") where "deleted_at" is not null and "purge_after_at" is not null;',
    );
    this.addSql(
      'create index "assets_storage_backend_index" on "assets" ("storage_backend", "deleted_at");',
    );

    // --- categories.main_image_asset_id ----------------------------------
    this.addSql(`alter table "categories"
      add column "main_image_asset_id" uuid null,
      add constraint "categories_main_image_fk" foreign key ("main_image_asset_id")
        references "assets" ("id") on delete set null;
    `);
    this.addSql(
      'create index "categories_main_image_asset_id_index" on "categories" ("main_image_asset_id");',
    );

    // --- cms_pages.body GIN index for asset-ref scan ---------------------
    // Reference-registry's CMS descriptor uses jsonb_path_exists on body;
    // this index keeps the probe sub-millisecond at the platform's scale.
    this.addSql(
      'create index "idx_cms_pages_body_asset_refs" on "cms_pages" using gin ("body" jsonb_path_ops);',
    );

    // --- backfill --------------------------------------------------------
    // Pass 1: copy storage_url into storage_locator for every row that
    // still has the column-default empty string.
    this.addSql(`
      update "assets"
      set "storage_locator" = "storage_url"
      where "storage_locator" = '';
    `);
    // Pass 2: rows whose pre-013 storage_url is an absolute URL are
    // routed through the runtime 'legacy' adapter. This preserves their
    // public URL verbatim — see research.md R11.
    this.addSql(`
      update "assets"
      set "storage_backend" = 'legacy'
      where "storage_locator" ~ '^https?://';
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "idx_cms_pages_body_asset_refs";');
    this.addSql(
      'alter table "categories" drop constraint if exists "categories_main_image_fk";',
    );
    this.addSql(
      'drop index if exists "categories_main_image_asset_id_index";',
    );
    this.addSql('alter table "categories" drop column if exists "main_image_asset_id";');

    this.addSql('drop index if exists "assets_storage_backend_index";');
    this.addSql('drop index if exists "assets_purge_due_index";');
    this.addSql('drop index if exists "assets_pending_cleanup_index";');
    this.addSql('drop index if exists "assets_folder_visible_index";');
    this.addSql('alter table "assets" drop constraint if exists "assets_storage_backend_check";');
    this.addSql('alter table "assets" drop constraint if exists "assets_visibility_check";');
    this.addSql('alter table "assets" drop constraint if exists "assets_folder_fk";');
    this.addSql(`alter table "assets"
      drop column if exists "mime_type_overridden",
      drop column if exists "purge_after_at",
      drop column if exists "pending_cleanup",
      drop column if exists "storage_locator",
      drop column if exists "storage_backend",
      drop column if exists "label",
      drop column if exists "visibility",
      drop column if exists "folder_id";
    `);

    this.addSql('drop index if exists "asset_folders_unique_name_per_parent";');
    this.addSql('drop index if exists "asset_folders_parent_position_index";');
    this.addSql('drop table if exists "asset_folders" cascade;');
  }
}
