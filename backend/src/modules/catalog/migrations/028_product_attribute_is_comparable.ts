import { Migration } from '@mikro-orm/migrations';

/**
 * Catalog 007 / T004 — ProductAttribute extension for the Compare module.
 *
 * Adds the `is_comparable` boolean column on `product_attributes`. Default
 * `false`, NOT NULL — backfill is the default itself, no row needs the
 * flag flipped on at install time.
 *
 * The flag is owned by the catalog module (research.md R-5): a property
 * of an attribute, just like `is_searchable` and `is_filterable`. The
 * comparisons module reads it through `CatalogQueryService` but never
 * writes to it.
 *
 * Side effects on flip: none. Unlike `is_searchable` (which triggers a
 * Meilisearch settings update via `attribute.updated.v1`), comparability
 * is read at comparison-render time directly from Postgres.
 *
 * See specs/007-compare-module/data-model.md §1.3, research.md R-5.
 */
export class Migration028ProductAttributeIsComparable extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "product_attributes"
        add column "is_comparable" boolean not null default false;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      'alter table "product_attributes" drop column if exists "is_comparable";',
    );
  }
}
