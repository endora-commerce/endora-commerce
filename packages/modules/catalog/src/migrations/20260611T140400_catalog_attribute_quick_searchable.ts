import { Migration } from '@mikro-orm/migrations';

/**
 * Quick-searchable attribute flag (feature 039 — US3).
 *
 * Adds `product_attributes.quick_searchable` (default false). Independent of
 * `is_searchable`: it controls whether the attribute's values participate in
 * Quick Order search (FR-012 / FR-013).
 */
export class Migration20260611T140400CatalogAttributeQuickSearchable extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "product_attributes" add column "quick_searchable" boolean not null default false;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "product_attributes" drop column "quick_searchable";');
  }
}
