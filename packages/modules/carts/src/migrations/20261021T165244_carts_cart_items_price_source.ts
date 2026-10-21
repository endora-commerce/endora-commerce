import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 160 (D-287 P1, FR-030) — `cart_items.price_source`: which tier of the
 * price-book resolution priced the line's unit price (`base`, `catalogue`,
 * `buyer`, `sale`), or `agreed` for a line ordered at a quote's agreed price.
 *
 * Written with `unit_price` by the cart's one pricing chain and copied onto the
 * order line at placement (`order_items.price_source`, owned by `orders`), so
 * `promotions` can later decide on it (P4). Nullable, no backfill: a line priced
 * before the feature has no recorded source and gets one on its next write.
 */
export class Migration20261021T165244CartsCartItemsPriceSource extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "cart_items" add column if not exists "price_source" varchar(16) null;');
    this.addSql('alter table "cart_items" drop constraint if exists "cart_items_price_source_check";');
    this.addSql(
      'alter table "cart_items" add constraint "cart_items_price_source_check" ' +
        `check ("price_source" is null or "price_source" in ('agreed', 'base', 'catalogue', 'buyer', 'sale'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "cart_items" drop constraint if exists "cart_items_price_source_check";');
    this.addSql('alter table "cart_items" drop column if exists "price_source";');
  }
}
