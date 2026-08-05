import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 068 — the catalog-owned category activation switch (data-model.md
 * §11). `is_active = false` means the category is hidden from storefront
 * navigation and its products are not reachable through it; it is orthogonal
 * to `deleted_at` (removed) and to `sales_channel_categories` (which channel
 * the category belongs to).
 *
 * `DEFAULT true` is load-bearing: every category that exists when this
 * migration runs must keep behaving exactly as it did. The only writer of
 * `false` today is the Ergonode importer, which auto-creates categories
 * inactive so a first import never exposes a source hierarchy to customers.
 */
export class Migration20260804T160244CatalogCategoryActivation extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "categories" add column "is_active" boolean not null default true;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "categories" drop column "is_active";`);
  }
}
