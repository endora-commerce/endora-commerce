import { Migration } from '@mikro-orm/migrations';

/**
 * The one storage cost of feature 086: a partial covering index over the
 * quantity-1 brackets, in amount order.
 *
 * `price_list_price_brackets` at `min_quantity = 1` **is** the per-(price list,
 * product) unit price, exactly and by check constraint. The table carries
 * `check (min_quantity >= 1)` and `check (max_quantity is null or
 * max_quantity >= min_quantity)`, and `resolvePriceBracket(rows, currency, 1)`
 * accepts a row when `min_quantity <= 1` and `max_quantity is null or >= 1`.
 * The first reduces to `min_quantity = 1`; the second always holds. So the
 * partial predicate below is not a heuristic narrowing — it selects every
 * listing price and nothing else, which is why a partial index can be built on
 * it at all.
 *
 * **Column order, and why it is this one.** `price_list_id` and `currency_code`
 * are equality predicates that select one candidate stream; `amount` is the
 * ordering; `product_id` is the tie-break that makes the merge's order total
 * and makes the scan index-only (measured: `Heap Fetches: 0`). Reversing the
 * last two would cost a heap fetch per row and lose the tie-break's position in
 * the sort.
 *
 * **Descending needs no second index.** PostgreSQL scans a btree backwards, so
 * `order by amount desc, product_id desc` uses this one.
 *
 * Measured on the design's synthetic corpora: 7 432 kB over 112 000
 * assignments, 132 MB over 1 597 000. Without it the ordering is a sort of the
 * whole candidate relation — 206 ms with a 4 176 kB external merge to disk, per
 * page view, per viewer.
 *
 * No foreign key, so no manifest `dependencies` entry changes and
 * `fk-dependency-drift` is unaffected.
 */

/** The index this migration installs — named once, read by the perf bench. */
export const UNIT_PRICE_AMOUNT_INDEX = 'price_list_price_brackets_unit_amount_idx';

export class Migration20260821T135907PriceListsUnitPriceAmountIndex extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create index if not exists "${UNIT_PRICE_AMOUNT_INDEX}"
           on "price_list_price_brackets" ("price_list_id", "currency_code", "amount", "product_id")
        where "min_quantity" = 1;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "${UNIT_PRICE_AMOUNT_INDEX}";`);
  }
}
