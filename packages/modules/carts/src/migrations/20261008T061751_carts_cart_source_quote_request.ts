import { Migration } from '@mikro-orm/migrations';

/**
 * `carts.source_quote_request_id` — the accepted Quote Request a basket was
 * seeded from (`specs/143-crm-sales-opportunities/`, FR-100).
 *
 * `orders.source_quote_request_id` has existed since the foundation schema and
 * nothing wrote it: the quote-to-order conversion seeds a basket at the agreed
 * unit prices, and the basket kept no word of which request those prices were
 * agreed on, so placement had nothing to copy. This is the missing half of
 * that road.
 *
 * Nullable, no backfill and no foreign key. No surviving record says which
 * request seeded a historical basket; and the column is a claim `orders`
 * re-reads through `quoteRequestReadPort` before it trusts it, so a request
 * that has gone needs no `on delete` rule — its id resolves to nothing, which
 * is the same answer as no id. No index either: nothing looks a basket up by
 * it.
 */
export class Migration20261008T061751CartsCartSourceQuoteRequest extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "carts" add column "source_quote_request_id" uuid null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "carts" drop column "source_quote_request_id";');
  }
}
