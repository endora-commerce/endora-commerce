import { Migration } from '@mikro-orm/migrations';

/**
 * Catalog 002 — ProductAttribute extensions (T015).
 *
 * Backs the new attribute capabilities introduced in feature 002:
 *   - `display_as_slider` boolean: presentation hint for filterable
 *     numeric/price attributes. Honored only when `value_type IN
 *     ('number','price')`; service layer rejects `display_as_slider=true`
 *     on any other type.
 *
 * The `value_type` column itself stays a plain `varchar(16)` with no
 * DB-level CHECK constraint (foundation 001 chose to enforce the enum
 * only at the application/Zod layer). New values `'multiselect'` and
 * `'price'` are added to the application enum in the same change set
 * (entity + Zod schema); no DDL change needed for them — both fit
 * within varchar(16).
 *
 * See specs/002-catalog-module/data-model.md §1.2, research.md R-4 / R-7.
 */
export class Migration20260429T070004CatalogProductAttributeExtensions extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "product_attributes"
        add column "display_as_slider" boolean not null default false;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      'alter table "product_attributes" drop column if exists "display_as_slider";',
    );
  }
}
