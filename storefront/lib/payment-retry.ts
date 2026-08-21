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
 * `redirect` is the gateway's own hosted page. Otherwise the attempt is open
 * with no provider session of its own to send them to — either because one was
 * already running (`opened: false`) or because the adapter settles inline — and
 * the destination is this platform's payment step for that order, which is
 * where each gateway module renders its own form.
 *
 * `null` means there is nowhere to send them and the page should say so rather
 * than navigate.
 */
export function paymentRetryDestination(
  orderId: string,
  result: PaymentRetryResult,
  paymentMethodCode: string,
): string | null {
  if (result.nextAction.kind === 'redirect') return result.nextAction.url;
  const gateway = paymentMethodCode.split('_')[0] ?? '';
  // The same three prefixes `/checkout` routes on after placement. A code from
  // any other adapter has no inline step and belongs back on the order page.
  if (gateway === 'stripe') return `/checkout/pay?id=${encodeURIComponent(orderId)}`;
  if (gateway === 'tpay' || gateway === 'payu') {
    return `/checkout/pay?id=${encodeURIComponent(orderId)}&gateway=${gateway}`;
  }
  return null;
}
