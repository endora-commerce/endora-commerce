import { Migration } from '@mikro-orm/migrations';

/**
 * Catalog 002 — Product type rename + virtual download fields (T044).
 *
 * Three changes (data-model.md §1.1, research.md R-1):
 *   - Rename `products.type` value 'variant' → 'configurable'. Foundation
 *     001 stored configurable products as type='variant'; feature 002
 *     renames this everywhere for consistency with the spec wording.
 *     The DB column itself is `varchar(16)` with no CHECK constraint
 *     (foundation enforces the enum only at the application/Zod layer),
 *     so the rename is a plain UPDATE.
 *   - Add 'bundle' as a new type value. No DDL needed for the same
 *     reason — varchar(16) already accommodates it. The application
 *     enum extension lives in T046 (productTypeSchema).
 *   - Add `download_asset_id` (uuid NULL FK to assets) and `download_url`
 *     (varchar(2048) NULL) for type='virtual'. Cross-field invariant
 *     ("exactly one of") is enforced at the service layer (T047), not
 *     by a DB CHECK — PG can't express the rule cleanly without
 *     duplicating the type comparison in every CHECK constraint.
 *
 * Rollback (down) reverses everything: drop new columns, then UPDATE
 * configurable rows back to 'variant'. Bundle rows would need to be
 * downgraded too — for safety we update them to 'simple' on rollback
 * since foundation has no native 'bundle' representation; rollback in
 * production with bundle data already present would be a separate
 * data-migration concern.
 */
export class Migration019ProductTypeAndVirtualFields extends Migration {
  override async up(): Promise<void> {
    // 1. Rename 'variant' → 'configurable'.
    this.addSql(
      `update "products" set "type" = 'configurable' where "type" = 'variant';`,
    );

    // 2. Add virtual download fields. Both nullable; "exactly one of"
    //    is enforced by the service (T047).
    this.addSql(`
      alter table "products"
        add column "download_asset_id" uuid null,
        add column "download_url" varchar(2048) null;
    `);
    this.addSql(`
      alter table "products"
        add constraint "fk_products_download_asset"
          foreign key ("download_asset_id")
          references "assets" ("id")
          on delete restrict;
    `);
    this.addSql(
      'create index "products_download_asset_id_index" on "products" ("download_asset_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "products_download_asset_id_index";');
    this.addSql(
      'alter table "products" drop constraint if exists "fk_products_download_asset";',
    );
    this.addSql(
      'alter table "products" drop column if exists "download_url", drop column if exists "download_asset_id";',
    );
    // Rollback type rename. Bundle-typed rows are downgraded to simple
    // because foundation 001 has no 'bundle' value.
    this.addSql(
      `update "products" set "type" = 'simple' where "type" = 'bundle';`,
    );
    this.addSql(
      `update "products" set "type" = 'variant' where "type" = 'configurable';`,
    );
  }
}
