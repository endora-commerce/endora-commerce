/**
 * Where a payment gateway hands the buyer back (issues #274, #287).
 *
 * Issue #274 moved all four gateways off `/checkout/*` and onto the order's
 * own page, on the ground that every `/checkout/*` route is a **placement**
 * surface and returning a buyer whose order already exists to one is how a
 * shop gets a second order for the same goods. The first half of that stands;
 * the destination does not. The owner ruled that **a correct payment lands on
 * the success page and a failed one on the failure page**, and that the pages
 * are to be corrected rather than the routing.
 *
 * PayU's `continueUrl` and Autopay's `ReturnURL` are one URL for every
 * outcome, so that ruling cannot be expressed in gateway configuration. So
 * every gateway hook — the two that discriminate and the two that cannot —
 * points here, at a landing that places nothing: it reads the order's own
 * payment state and forwards to success, to failure, or to a wait while the
 * gateway's confirmation is still in flight. One behaviour, not two.
 *
 * Kept here rather than four times over because the rule is the platform's,
 * not any one gateway's, and `check:module-boundary` (rightly) forbids the
 * gateway modules from sharing it between themselves.
 */

/**
 * What the gateway said as it handed the buyer back.
 *
 * - `returned` — the gateway sent the buyer back and did not say how it went
 *   (PayU `continueUrl`, Autopay `ReturnURL`), or it says the payment went
 *   through (Stripe `success_url`, TPay `successUrl`) — which is a claim the
 *   platform will not take from a URL, since the same URL fires a purchase
 *   conversion and a buyer can replay it. The settlement notification is the
 *   authority, and it may not have arrived yet.
 * - `cancelled` — the buyer left the gateway without paying (Stripe
 *   `cancel_url` fires on *back*, not on a decline). Nothing was charged and
 *   the order is waiting to be paid.
 * - `failed` — the gateway reported the attempt as unsuccessful (TPay
 *   `errorUrl`).
 *
 * The landing trusts this **downwards only**: `failed` and `cancelled` show
 * the failure page before our own notification lands, which costs nothing
 * because that page only offers to pay the same order again and re-reads the
 * order every time. No value here can produce a success page.
 */
export type PaymentReturnOutcome = 'returned' | 'cancelled' | 'failed';

/**
 * Build the post-payment landing for `orderId`:
 * `/checkout/return?id=<orderId>&outcome=<outcome>`.
 *
 * The outcome is a hint for the landing's decision, never the payment's
 * status — a gateway's return URL is a browser redirect the buyer can replay,
 * so the order's own `paymentStatus` stays the authority.
 */
export function storefrontPaymentReturnUrl(
  storefrontBaseUrl: string,
  orderId: string,
  outcome: PaymentReturnOutcome,
): string {
  const base = storefrontBaseUrl.replace(/\/+$/, '');
  return `${base}/checkout/return?id=${encodeURIComponent(orderId)}&outcome=${outcome}`;
}
