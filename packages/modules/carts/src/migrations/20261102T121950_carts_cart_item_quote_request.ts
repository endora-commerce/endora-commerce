import { Migration } from '@mikro-orm/migrations';

/**
 * `cart_items.quote_request_id` — the accepted Quote Request a line's agreed
 * price came from (issue #167).
 *
 * A quote's validity date was checked when `convert-to-order` seeded the
 * basket and never again, so a basket seeded on the last valid day could be
 * ordered at the agreed prices at any later time. Placement now reads the
 * quote again before it accepts a line at its agreed price; this column is
 * what names the quote for the line.
 *
 * Backfilled from the basket's own mark: a line that carries an agreement was
 * written by the quote seed, which replaces the whole basket and stamps
 * `carts.source_quote_request_id` with the same request, and the mark is
 * cleared only when the basket empties. Both tables are this module's own.
 *
 * Nullable, no foreign key and no index, for the reasons
 * `carts.source_quote_request_id` has none: the column is a claim `orders`
 * re-reads through `quoteRequestReadPort`, a request that has gone resolves to
 * nothing, and nothing looks a line up by it.
 */
export class Migration20261102T121950CartsCartItemQuoteRequest extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "cart_items" add column "quote_request_id" uuid null;');
    this.addSql(
      'update "cart_items" as "ci" set "quote_request_id" = "c"."source_quote_request_id" ' +
        'from "carts" as "c" ' +
        'where "c"."id" = "ci"."cart_id" ' +
        'and "c"."source_quote_request_id" is not null ' +
        'and "ci"."agreed_quantity" is not null;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "cart_items" drop column "quote_request_id";');
  }
}
