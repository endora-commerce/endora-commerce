import { Migration } from '@mikro-orm/migrations';

/**
 * `categories.main_image_asset_id`, its foreign key to `assets` and its index
 * (feature 013 — a catalogue category's main image from the assets library),
 * created by `catalog`.
 *
 * `Category.mainImageAssetId` maps the column. Until issue #611 only
 * `assets_library`'s frozen `Migration20260505T102206AssetsLibraryInit`
 * created the three, so another module's migration decided this module's
 * schema — the write the migration table-ownership rule (feature 097, R2)
 * refuses. Declaring `catalog` in `assets_library` was no remedy: this module
 * declares `assets_library`, so that closes a cycle. The frozen init keeps
 * its class name and lost only these statements, the shape D-226 gave the
 * `cms_pages` index the same body carried
 * (`Migration20260912T125709CmsPageBodyAssetRefIndex`) and feature 134 gave
 * the stock columns `inventory` carried
 * (`Migration20260925T125527CatalogInventoryColumns`).
 *
 * The closure holds in the direction the SQL runs: this module declares
 * `assets_library`, so `assets` exists by the time this runs.
 *
 * **`if not exists` and a `pg_constraint` probe**, because every database
 * that ran the frozen init already has all three, and there this must be a
 * no-op. PostgreSQL has no `add constraint if not exists`; the probe form
 * follows `20260925T125527`. Types, names and `on delete set null` are the
 * frozen statements verbatim, so the two paths reach one schema.
 *
 * **`down()` is deliberately empty**, for `20260925T125527`'s reason:
 * `categories` is created by the platform's `core_foundation_init`, which a
 * hard uninstall of this module never reverts, so the rows outlive `catalog`
 * and dropping the column would silently lose every category's main image.
 */
export class Migration20261114T000706CatalogCategoryMainImage extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "categories" add column if not exists "main_image_asset_id" uuid null;');
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint
          where "conname" = 'categories_main_image_fk'
            and "conrelid" = '"categories"'::regclass
        ) then
          alter table "categories"
            add constraint "categories_main_image_fk" foreign key ("main_image_asset_id")
              references "assets" ("id") on delete set null;
        end if;
      end $$;
    `);
    this.addSql(
      'create index if not exists "categories_main_image_asset_id_index" on "categories" ("main_image_asset_id");',
    );
  }

  override async down(): Promise<void> {
    // Intentionally empty — see the class comment.
  }
}
