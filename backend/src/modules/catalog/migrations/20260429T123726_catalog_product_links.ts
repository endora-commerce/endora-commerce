import { Migration } from '@mikro-orm/migrations';

/**
 * Catalog 002 — Product Links (T101, US4, data-model.md §2.7).
 *
 * Single table `product_links` for related / up-sell / cross-sell pairings:
 *   - composite PK on `id`
 *   - UNIQUE (source_product_id, target_product_id, kind) — same pair can
 *     appear once per kind, never twice for the same kind
 *   - CHECK source_product_id <> target_product_id — DB-level guard against
 *     self-links so even raw SQL inserts are blocked (defence-in-depth on
 *     top of the service-layer SELF_LINK_NOT_ALLOWED 400 in T104)
 *   - CHECK kind IN ('related','up_sell','cross_sell')
 *   - position int default 0 — admin-curated ordering per (source, kind)
 *   - both FKs cascade on product delete (link rows have no value when
 *     either side is gone)
 */
export class Migration20260429T123726CatalogProductLinks extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "product_links" (
        "id" uuid not null,
        "source_product_id" uuid not null,
        "target_product_id" uuid not null,
        "kind" varchar(16) not null,
        "position" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "product_links_pkey" primary key ("id"),
        constraint "uniq_product_links_source_target_kind"
          unique ("source_product_id", "target_product_id", "kind"),
        constraint "chk_product_links_no_self"
          check ("source_product_id" <> "target_product_id"),
        constraint "chk_product_links_kind"
          check ("kind" in ('related', 'up_sell', 'cross_sell')),
        constraint "fk_product_links_source"
          foreign key ("source_product_id") references "products" ("id") on delete cascade,
        constraint "fk_product_links_target"
          foreign key ("target_product_id") references "products" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index "product_links_source_kind_index" on "product_links" ("source_product_id", "kind");',
    );
    this.addSql(
      'create index "product_links_target_index" on "product_links" ("target_product_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "product_links" cascade;');
  }
}
