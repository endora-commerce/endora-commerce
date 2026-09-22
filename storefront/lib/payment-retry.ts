import type { PaymentRetryResult } from './api/payments';

/**
 * Pure routing rules for the buyer's "pay again" button (issue #264). Kept in
 * its own module — no server-only imports — so both decisions are unit-testable
 * without the auth-gated order page.
 */

/**
 * The payment states in which the buyer still owes this money themselves — the
 * mirror of `BUYER_STILL_OWES` in the backend's `PaymentRetryService`, so the
 * control is never shown to a buyer the server will refuse (feature 085,
 * FR-012).
 *
 * An allow-list of two rather than a negation of `paid`: `deferred` is a
 * credit-limit order whose credit was drawn inside the placement transaction,
 * and `refunded` is settled the other way. Neither has a session for the buyer
 * to open.
 */
const BUYER_STILL_OWES = new Set(['awaiting_payment', 'failed']);

/**
 * Whether the order page offers the buyer a way to pay again.
 *
 * The **payment** axis decides, not the lifecycle status. That used to be
 * forced: every payment method in the tree was seeded
 * `status_on_failure = 'cancelled'`, so a declined card left the order terminal
 * and reading `order.status` would have hidden the button from exactly the
 * buyers it exists for. Feature 085 changed the shipped default to `on_hold`
 * and made the ingress record the decline on the money axis as `failed`, so
 * `failed` is now the ordinary state of a buyer who has to try again — and it
 * is the state this control most exists for. The backend refuses anything this
 * lets through, and says why.
 *
 * Only gateway methods qualify. A bank transfer, a cash-on-delivery order and a
 * credit-limit order are all unpaid too, and for none of them is there a
 * payment session for the buyer to open — the first two are settled out of band
 * and the third is already drawn.
 */
export function offersPaymentRetry(order: {
  paymentStatus: string;
  paymentMethod: { kind: string };
}): boolean {
  return BUYER_STILL_OWES.has(order.paymentStatus) && order.paymentMethod.kind === 'gateway';
}

/**
 * Where the buyer goes after the retry call answers.
 *
 * One rule: the gateway's own hosted page, when the adapter opened a session
 * and handed us its URL. `null` means there is nowhere to send them and the
 * page should say so rather than navigate — both call sites fall back to the
 * order page's own `?error=` sentence.
 *
 * **There used to be a second rule, and it left with the fragments.** An
 * adapter that settles inline returns no redirect, and the buyer was sent to
 * `/checkout/pay?id=…&gateway=…` — this platform's inline payment step, which
 * `specs/134-paid-module-extraction/` T041 (ruling O-1(b)) moves out of this
 * repository along with the four forms it routed between. Routing a buyer there
 * from a storefront that has copied no fragment in would be a 404 at the worst
 * possible moment, so the free rule is the honest one: a URL, or nowhere. A
 * shop that copies an inline gateway's fragment back in re-adds its own step
 * routing here.
 */
export function paymentRetryDestination(result: PaymentRetryResult): string | null {
  if (result.nextAction.kind === 'redirect') return result.nextAction.url;
  return null;
}
