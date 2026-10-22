import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 161, G15 redesign (`specs/161-price-book-editor/research.md` R14) —
 * `price_list_product_lines`: one row per **product line** of a book, a product
 * the book holds a product or a variant row of. The grid's lines read counts a
 * book's product lines and hands the catalogue its membership from these
 * unique keys instead of from every matrix row with duplicates (50 000 keys
 * against 125 000 rows at the budget's size).
 *
 * Maintained by this module's own writes in their transactions (the batch,
 * the base-price write, the duplicate, the demo); a product's hard delete
 * cascades here as it does to the rows; a variant delete that leaves a product
 * line without rows is reconciled from the catalogue's `product.updated.v1`.
 * Backfilled here from the rows already stored.
 *
 * `products` is `catalog`'s table, which this module's manifest already
 * depends on (its matrix rows reference it the same way).
 */
export class Migration20261022T182527PriceListsProductLines extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "price_list_product_lines" (
      "price_list_id" uuid not null,
      "product_id" uuid not null,
      constraint "price_list_product_lines_pkey" primary key ("price_list_id", "product_id"),
      constraint "price_list_product_lines_price_list_id_foreign"
        foreign key ("price_list_id") references "price_lists" ("id") on delete cascade,
      constraint "price_list_product_lines_product_id_foreign"
        foreign key ("product_id") references "products" ("id") on delete cascade
    );`);
    this.addSql(
      `create index if not exists "price_list_product_lines_product_idx" on "price_list_product_lines" ("product_id");`,
    );
    this.addSql(`insert into "price_list_product_lines" ("price_list_id", "product_id")
      select distinct e."price_list_id", e."product_id" from "price_list_matrix_entries" e
       where e."product_id" is not null
      on conflict do nothing;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "price_list_product_lines";`);
  }
}
