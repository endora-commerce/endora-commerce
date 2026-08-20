import type { PaymentRetryResult } from './api/payments';

/**
 * Pure routing rules for the buyer's "pay again" button (issue #264). Kept in
 * its own module — no server-only imports — so both decisions are unit-testable
 * without the auth-gated order page.
 */

/**
 * Whether the order page offers the buyer a way to pay again.
 *
 * The **payment** axis decides, not the lifecycle status. Every payment method
 * in the tree is seeded `status_on_failure = 'cancelled'`, so the settlement
 * ingress moves an order to `cancelled` on the first decline — reading
 * `order.status` here would hide the button from exactly the buyers it exists
 * for. The backend refuses anything this lets through, and says why.
 *
 * Only gateway methods qualify. A bank transfer, a cash-on-delivery order and a
 * credit-limit order are all `awaiting_payment` too, and for none of them is
 * there a payment session for the buyer to open — the first two are settled out
 * of band and the third is already drawn.
 */
export function offersPaymentRetry(order: {
  paymentStatus: string;
  paymentMethod: { kind: string };
}): boolean {
  return order.paymentStatus === 'awaiting_payment' && order.paymentMethod.kind === 'gateway';
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
