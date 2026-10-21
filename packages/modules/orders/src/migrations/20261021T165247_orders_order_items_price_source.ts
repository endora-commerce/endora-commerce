import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 160 (D-287 P1, FR-030) — `order_items.price_source`: the price source
 * of the cart line the order line was placed from (`agreed`, `base`,
 * `catalogue`, `buyer`, `sale`), copied at placement.
 *
 * Nullable, no backfill: an order line placed before the feature has no
 * recorded source, and an order line is never re-priced.
 */
export class Migration20261021T165247OrdersOrderItemsPriceSource extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "order_items" add column if not exists "price_source" varchar(16) null;');
    this.addSql('alter table "order_items" drop constraint if exists "order_items_price_source_check";');
    this.addSql(
      'alter table "order_items" add constraint "order_items_price_source_check" ' +
        `check ("price_source" is null or "price_source" in ('agreed', 'base', 'catalogue', 'buyer', 'sale'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "order_items" drop constraint if exists "order_items_price_source_check";');
    this.addSql('alter table "order_items" drop column if exists "price_source";');
  }
}
