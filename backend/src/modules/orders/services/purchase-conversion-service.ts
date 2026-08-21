import type Redis from 'ioredis';

/**
 * Whether an order still owes a GA4 `purchase` conversion (issue #277).
 *
 * The storefront counts an order's conversion on the first page the buyer
 * actually sees it on, and never again. That is one fact about one order, and
 * neither of the two surfaces that may count it can hold it:
 *
 * - `/checkout/success` is where an offline placement lands, along with
 *   Stripe's `success_url`, TPay's `successUrl` and every inline
 *   `/checkout/pay` form that succeeds;
 * - `/orders/:id` is where a PayU or Autopay redirect, a Stripe cancel and a
 *   TPay failure land, and where the buyer comes back to when they closed the
 *   tab or paid a second time.
 *
 * A marker in the browser answers neither, because it is gone with the cache
 * and never reaches the buyer's second device. So the platform holds it.
 *
 * **It is not a column on the order.** This is an analytics fact, not a
 * business one: nothing in the order's lifecycle, its invoicing or its
 * fulfilment depends on whether a tag fired, no operator screen shows it, and
 * losing it costs one conversion rather than one order. Redis is what that
 * buys — no schema, no migration, and an expiry, which the order table has no
 * way to express.
 *
 * **The claim is opened at placement, not at the first view.** The difference
 * decides what happens to every order placed before this existed: those were
 * counted already, by the Success Page that counted unconditionally, and they
 * have no claim — so a buyer opening a two-month-old order today reports
 * nothing. Had the marker instead recorded "already counted", their absence
 * would have read as "not yet counted" and the fix would have backfilled last
 * quarter's revenue onto this morning.
 */

/** Key prefix for the per-order claim. */
const KEY_PREFIX = 'orders:purchase-conversion:';

/**
 * How long a conversion stays owed.
 *
 * A conversion is owed until the buyer sees the order, and a buyer who has not
 * opened it within a month is not going to produce a session GA4 would
 * usefully attribute. Bounded on purpose: an unclaimed key that never expires
 * is an unbounded key space keyed by order id.
 */
export const PURCHASE_CONVERSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export class PurchaseConversionService {
  constructor(private readonly redis: Redis) {}

  /**
   * Record that `orderId` owes a conversion. Called once per placed order.
   *
   * Deliberately not `NX`: re-opening an existing claim is a no-op with the
   * expiry refreshed, and an order is placed once, so there is no case where
   * the difference is observable.
   */
  async open(orderId: string): Promise<void> {
    await this.redis.set(KEY_PREFIX + orderId, '1', 'EX', PURCHASE_CONVERSION_TTL_SECONDS);
  }

  /**
   * Spend the claim on `orderId`: `true` for the caller that had it, `false`
   * for everyone after, and `false` for an order that never owed one.
   *
   * `DEL` reports how many keys it removed and is atomic, so two devices
   * loading the order at the same instant cannot both win.
   */
  async claim(orderId: string): Promise<boolean> {
    return (await this.redis.del(KEY_PREFIX + orderId)) === 1;
  }
}
