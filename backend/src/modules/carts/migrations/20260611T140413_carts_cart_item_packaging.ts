import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 043 — packaging-unit snapshot on cart lines. When a buyer orders a
 * packaging unit (e.g. a pallet), the line records which unit it came from so
 * the cart/order/RFQ can display the unit name appended to the product name.
 * All nullable — plain single-piece lines leave them empty.
 */
export class Migration20260611T140413CartsCartItemPackaging extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "cart_items" add column "packaging_unit_id" uuid null;');
    this.addSql('alter table "cart_items" add column "packaging_unit_name" varchar(160) null;');
    this.addSql('alter table "cart_items" add column "packaging_unit_base_quantity" integer null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "cart_items" drop column "packaging_unit_base_quantity";');
    this.addSql('alter table "cart_items" drop column "packaging_unit_name";');
    this.addSql('alter table "cart_items" drop column "packaging_unit_id";');
  }
}
