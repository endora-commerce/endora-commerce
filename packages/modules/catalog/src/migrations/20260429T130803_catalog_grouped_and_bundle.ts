import { Migration } from '@mikro-orm/migrations';

/**
 * Catalog 002 — Composite product structure (T123, US5, data-model.md §2.8/§2.9).
 *
 * Three tables:
 *   - grouped_items: parent product (type='grouped') has a fixed list of
 *     child products with quantities. UNIQUE (parent, child) so the same
 *     child can't be listed twice.
 *   - bundle_slots: parent product (type='bundle') has named slots, each
 *     with a min/max quantity range. Position is admin-curated.
 *   - bundle_slot_options: each slot can choose between option products.
 *     UNIQUE (slot_id, product_id) so the same product can't be both
 *     "default" and "alternative" inside a slot.
 *
 * The "no nested composites" invariant (research R-8) is enforced at the
 * service layer, not by DDL — a CHECK constraint would need to JOIN
 * products which PG doesn't support inside CHECK.
 */
export class Migration20260429T130803CatalogGroupedAndBundle extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "grouped_items" (
        "id" uuid not null,
        "parent_product_id" uuid not null,
        "child_product_id" uuid not null,
        "quantity" int not null,
        "position" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "grouped_items_pkey" primary key ("id"),
        constraint "uniq_grouped_items_parent_child"
          unique ("parent_product_id", "child_product_id"),
        constraint "chk_grouped_items_quantity_positive"
          check ("quantity" > 0),
        constraint "chk_grouped_items_no_self"
          check ("parent_product_id" <> "child_product_id"),
        constraint "fk_grouped_items_parent"
          foreign key ("parent_product_id") references "products" ("id") on delete cascade,
        constraint "fk_grouped_items_child"
          foreign key ("child_product_id") references "products" ("id") on delete restrict
      );
    `);
    this.addSql(
      'create index "grouped_items_parent_index" on "grouped_items" ("parent_product_id");',
    );

    this.addSql(`
      create table "bundle_slots" (
        "id" uuid not null,
        "parent_product_id" uuid not null,
        "name" jsonb not null,
        "min_quantity" int not null default 0,
        "max_quantity" int not null,
        "position" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "bundle_slots_pkey" primary key ("id"),
        constraint "chk_bundle_slots_min_le_max"
          check ("min_quantity" <= "max_quantity"),
        constraint "chk_bundle_slots_min_nonneg"
          check ("min_quantity" >= 0),
        constraint "chk_bundle_slots_max_positive"
          check ("max_quantity" > 0),
        constraint "fk_bundle_slots_parent"
          foreign key ("parent_product_id") references "products" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index "bundle_slots_parent_index" on "bundle_slots" ("parent_product_id");',
    );

    this.addSql(`
      create table "bundle_slot_options" (
        "id" uuid not null,
        "slot_id" uuid not null,
        "option_product_id" uuid not null,
        "default_quantity" int not null default 1,
        "position" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "bundle_slot_options_pkey" primary key ("id"),
        constraint "uniq_bundle_slot_options_slot_product"
          unique ("slot_id", "option_product_id"),
        constraint "chk_bundle_slot_options_qty_positive"
          check ("default_quantity" > 0),
        constraint "fk_bundle_slot_options_slot"
          foreign key ("slot_id") references "bundle_slots" ("id") on delete cascade,
        constraint "fk_bundle_slot_options_option"
          foreign key ("option_product_id") references "products" ("id") on delete restrict
      );
    `);
    this.addSql(
      'create index "bundle_slot_options_slot_index" on "bundle_slot_options" ("slot_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "bundle_slot_options" cascade;');
    this.addSql('drop table if exists "bundle_slots" cascade;');
    this.addSql('drop table if exists "grouped_items" cascade;');
  }
}
