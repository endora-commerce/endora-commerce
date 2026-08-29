import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Whether an order still owes a GA4 `purchase` conversion (issue #277).
 *
 * The storefront reports an order's conversion on the first page the buyer
 * actually sees it on, and never again. That is one fact about one order, and
 * neither of the surfaces that may report it can hold it:
 *
 * - the checkout Success Page is where an offline placement lands, along with
 *   Stripe's `success_url`, TPay's `successUrl` and every inline
 *   `/checkout/pay` form that succeeds;
 * - the order page is where a gateway redirect return lands, and where the
 *   buyer comes back to when they closed the tab or paid a second time.
 *
 * Which of the two a given gateway buyer arrives on is a routing decision that
 * has already changed once and is changing again; nothing here depends on it.
 * Both pages spend the same claim, so the answer is the same whichever one
 * they land on and whichever one they land on *second*.
 *
 * A marker in the browser answers none of it, because it is gone with the
 * cache and never reaches the buyer's second device. So the order carries it,
 * in a column: an expiring key would have made the answer depend on how long
 * the buyer took, and a cache flush would have let one order be counted twice.
 *
 * **The sense is inverted**, and that is what keeps this fix off the orders
 * that predate it. `purchase_conversion_owed` says a conversion is *owed*, not
 * that one was reported, and it defaults to `false` — so every historical row
 * says "owes nothing", which is right, because the old unconditional Success
 * Page counted them all already. A column meaning "already counted" would have
 * defaulted to `false` as well and read as "not yet counted", turning the
 * first view of a two-month-old order into a report of last quarter's revenue
 * against today's date.
 *
 * **Not a Command.** Principle XIII covers admin and domain writes, so that
 * auditing and undo stay uniform; this is neither. It changes nothing about
 * the order's lifecycle, money or fulfilment, no operator performs it, and it
 * has no undo worth the name — a GA4 conversion cannot be recalled. Running it
 * through the Command Bus would put an audit row in the operator's log for
 * every buyer who opened a fresh order, which is noise standing between them
 * and the writes that do matter.
 */
export class PurchaseConversionService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * Spend the claim on `orderId`: `true` for the caller that had it, `false`
   * for every caller after it, and `false` for an order that never owed one.
   *
   * One conditional `UPDATE`, so the decision and the write are the same
   * statement: PostgreSQL takes the row lock before it re-evaluates the
   * `where`, so of two devices loading the order in the same instant exactly
   * one sees a row come back. A read followed by a write would let both pass
   * the read.
   *
   * `em.execute` rather than `em.getKnex()`: knex takes its own pooled
   * connection and commits on its own, outside whatever transaction the caller
   * is in (issue #200). Nothing here runs in one today, and the day something
   * does, this must roll back with it.
   */
  async claim(orderId: string): Promise<boolean> {
    const rows = await this.emFactory().execute<Array<{ id: string }>>(
      `update "orders"
          set "purchase_conversion_owed" = false,
              "purchase_conversion_reported_at" = now()
        where "id" = ?
          and "purchase_conversion_owed" = true
        returning "id"`,
      [orderId],
    );
    return rows.length === 1;
  }
}
