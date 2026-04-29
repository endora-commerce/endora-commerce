import { Migration } from '@mikro-orm/migrations';

/**
 * Catalog 002 — Gallery (T062, US3, data-model.md §2.3, §2.4).
 *
 * Two tables:
 *   - gallery_items: per-Product list of Asset references with `position`
 *     ordering. Asset is FK → assets(id) ON DELETE RESTRICT (Asset
 *     survives gallery item deletion).
 *   - gallery_item_labels: per-Product label assignments. Per-product
 *     UNIQUE constraint on (product_id, label) enforces the spec rule
 *     that only ONE Element of each label kind can exist per Product
 *     (research.md R-2). The `product_id` column is duplicated on the
 *     bridge so PG can enforce the unique constraint without a sub-query.
 *
 * Naming follows Principle VI (plural snake_case tables, FK columns
 * named `{singular}_id`).
 */
export class Migration020GalleryItemsAndLabels extends Migration {
  override async up(): Promise<void> {
    // -- gallery_items --------------------------------------------------------
    this.addSql(`
      create table "gallery_items" (
        "id" uuid not null,
        "product_id" uuid not null,
        "asset_id" uuid not null,
        "position" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "gallery_items_pkey" primary key ("id"),
        constraint "fk_gallery_items_product"
          foreign key ("product_id") references "products" ("id") on delete cascade,
        constraint "fk_gallery_items_asset"
          foreign key ("asset_id") references "assets" ("id") on delete restrict
      );
    `);
    this.addSql(
      'create index "gallery_items_product_id_index" on "gallery_items" ("product_id");',
    );
    this.addSql(
      'create index "gallery_items_product_id_position_index" on "gallery_items" ("product_id", "position");',
    );

    // -- gallery_item_labels (bridge) ----------------------------------------
    // Composite PK on (gallery_item_id, label) prevents a single
    // gallery_item from receiving the same label twice.
    // UNIQUE(product_id, label) enforces "only one of each label per
    // Product" — the load-bearing constraint that makes the swap
    // operation safe (research.md R-2).
    this.addSql(`
      create table "gallery_item_labels" (
        "gallery_item_id" uuid not null,
        "product_id" uuid not null,
        "label" varchar(16) not null,
        constraint "gallery_item_labels_pkey" primary key ("gallery_item_id", "label"),
        constraint "uniq_gallery_item_labels_product_label" unique ("product_id", "label"),
        constraint "fk_gallery_item_labels_item"
          foreign key ("gallery_item_id") references "gallery_items" ("id") on delete cascade,
        constraint "fk_gallery_item_labels_product"
          foreign key ("product_id") references "products" ("id") on delete cascade,
        constraint "chk_gallery_item_labels_label"
          check ("label" in ('base_image', 'small_image', 'thumbnail'))
      );
    `);
    this.addSql(
      'create index "gallery_item_labels_product_id_index" on "gallery_item_labels" ("product_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "gallery_item_labels" cascade;');
    this.addSql('drop table if exists "gallery_items" cascade;');
  }
}
