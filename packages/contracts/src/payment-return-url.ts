/**
 * Where a payment gateway returns the buyer (issue #274).
 *
 * Every `/checkout/*` route is a **placement** surface: it exists to turn a
 * cart into an order. Returning a buyer whose order already exists to one of
 * them is how a shop gets a second order for the same goods — which is what
 * all four gateways did, each with its own hand-built URL. The order's own
 * page renders correctly whether or not the payment landed, so that is the one
 * landing every gateway uses.
 *
 * Kept here rather than four times over because the rule is the platform's,
 * not any one gateway's, and `check:module-boundary` (rightly) forbids the
 * gateway modules from sharing it between themselves.
 */

/**
 * Why the buyer is back on the order page.
 *
 * - `returned` — the gateway sent the buyer back and did not say how it went
 *   (PayU `continueUrl`, Autopay `ReturnURL`). The settlement notification is
 *   the authority, and it may not have arrived yet.
 * - `cancelled` — the buyer left the gateway without paying (Stripe
 *   `cancel_url` fires on *back*, not on a decline). Nothing failed and the
 *   attempt is still open.
 * - `failed` — the gateway reported the attempt as unsuccessful (TPay
 *   `errorUrl`).
 */
export type PaymentReturnOutcome = 'returned' | 'cancelled' | 'failed';

/**
 * Build the post-payment landing for `orderId`: `/orders/:id?payment=<outcome>`.
 *
 * The outcome is a hint for the copy the page shows, never the payment's
 * status — a gateway's return URL is a browser redirect the buyer can replay,
 * so the order's own `paymentStatus` stays the authority.
 */
export function storefrontOrderReturnUrl(
  storefrontBaseUrl: string,
  orderId: string,
  outcome: PaymentReturnOutcome,
): string {
  const base = storefrontBaseUrl.replace(/\/+$/, '');
  return `${base}/orders/${encodeURIComponent(orderId)}?payment=${outcome}`;
}
