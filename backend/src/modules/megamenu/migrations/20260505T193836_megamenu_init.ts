import { Migration } from '@mikro-orm/migrations';

/**
 * Megamenu module — feature 015 / data-model.md.
 *
 * Schema changes (one atomic migration):
 *   - new tables: `megamenus`, `megamenu_items`, `megamenu_bindings`.
 *   - GIN index on `megamenu_items.target` (jsonb_path_ops) so the
 *     cross-module reference scan stays fast.
 *   - btree index on `megamenu_items(megamenu_id, parent_id, position)`
 *     drives the per-tree fetch.
 *   - **partial unique index** on
 *     `megamenu_bindings(sales_channel_id, language) WHERE active = true`
 *     enforces "exactly one active megamenu per (channel, language)"
 *     (FR-008 + research § R3) at the DB level.
 *
 * No seed rows; no data backfill — first-time admins create the first
 * configuration through the admin UI.
 */
export class Migration20260505T193836MegamenuInit extends Migration {
  override async up(): Promise<void> {
    // ────────────────────────────────────────────────────────────────────
    // 1) megamenus
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "megamenus" (
        "id" uuid not null,
        "name" varchar(200) not null,
        "description" text null,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "megamenus_pkey" primary key ("id")
      );
    `);

    // ────────────────────────────────────────────────────────────────────
    // 2) megamenu_items — adjacency-list tree
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "megamenu_items" (
        "id" uuid not null,
        "megamenu_id" uuid not null,
        "parent_id" uuid null,
        "position" int not null default 0,
        "kind" varchar(32) not null,
        "labels" jsonb not null default '{}'::jsonb,
        "descriptions" jsonb null,
        "target" jsonb not null default '{}'::jsonb,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "megamenu_items_pkey" primary key ("id"),
        constraint "megamenu_items_megamenu_fk" foreign key ("megamenu_id")
          references "megamenus" ("id") on delete cascade,
        constraint "megamenu_items_parent_fk" foreign key ("parent_id")
          references "megamenu_items" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index "idx_megamenu_items_tree" on "megamenu_items" ("megamenu_id", "parent_id", "position");',
    );
    this.addSql(
      'create index "idx_megamenu_items_target_refs" on "megamenu_items" using gin ("target" jsonb_path_ops);',
    );

    // ────────────────────────────────────────────────────────────────────
    // 3) megamenu_bindings
    // ────────────────────────────────────────────────────────────────────
    this.addSql(`
      create table "megamenu_bindings" (
        "megamenu_id" uuid not null,
        "sales_channel_id" uuid not null,
        "language" varchar(8) not null,
        "active" boolean not null default false,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "megamenu_bindings_pkey"
          primary key ("megamenu_id", "sales_channel_id", "language"),
        constraint "megamenu_bindings_megamenu_fk" foreign key ("megamenu_id")
          references "megamenus" ("id") on delete cascade,
        constraint "megamenu_bindings_channel_fk" foreign key ("sales_channel_id")
          references "sales_channels" ("id") on delete cascade
      );
    `);
    // Partial unique index (FR-008 / R3) — exactly one active megamenu
    // per (sales_channel_id, language).
    this.addSql(
      'create unique index "idx_megamenu_bindings_active_uniq" on "megamenu_bindings" ("sales_channel_id", "language") where "active" = true;',
    );
    // Lookup index for the storefront resolver.
    this.addSql(
      'create index "idx_megamenu_bindings_channel_lang" on "megamenu_bindings" ("sales_channel_id", "language");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "megamenu_bindings" cascade;');
    this.addSql('drop table if exists "megamenu_items" cascade;');
    this.addSql('drop table if exists "megamenus" cascade;');
  }
}
