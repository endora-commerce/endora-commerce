import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 032 — Rename product lifecycle status `archived` → `inactive`.
 * Column is `varchar(16)`; no PG enum change required.
 */
export class Migration20260526T124736CatalogProductStatusInactive extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      update "products"
         set "status" = 'inactive'
       where "status" = 'archived';
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      update "products"
         set "status" = 'archived'
       where "status" = 'inactive';
    `);
  }
}
