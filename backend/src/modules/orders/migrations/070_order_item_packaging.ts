import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 043 — packaging-unit snapshot on order lines. Structured copy of the
 * unit a line was ordered as (the unit name is also appended to
 * `product_snapshot.name`). Nullable — plain lines have none.
 */
export class Migration070OrderItemPackaging extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "order_items" add column "packaging_unit_snapshot" jsonb null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "order_items" drop column "packaging_unit_snapshot";');
  }
}
