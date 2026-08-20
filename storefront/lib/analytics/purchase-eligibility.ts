/**
 * When an order may count as a GA4 `purchase` conversion (issue #274).
 *
 * The checkout Success Page fired the conversion for whatever order it was
 * handed. PayU and Autopay return the buyer to their single return URL
 * *whatever the outcome*, so a declined payment was counted as revenue. Their
 * return URLs now point at the order page, but the page itself has to be
 * right: any future redirect that lands here would inflate the count again.
 *
 * The rule is not "payment status is `paid`". Bank transfer, cash on pickup
 * and credit limit are settled out of band — a bank transfer clears days
 * later, a credit-limit invoice later still — so waiting for `paid` would not
 * delay those conversions, it would drop them. For those three the placement
 * *is* the conversion; the order is booked and the goods are committed. Only
 * an online gateway payment is expected to settle while the buyer is on the
 * page, so only a gateway order has to prove it.
 */

import type { GaPurchase } from './ecommerce';
import type { OrderSummary } from '../api/orders';

/** Payment kinds whose settlement is arranged outside the checkout session. */
const DEFERRED_SETTLEMENT_KINDS = new Set(['bank_transfer', 'pickup', 'credit_limit']);

/** Payment statuses that mean the order can no longer count as a conversion. */
const NON_CONVERTING_STATUSES = new Set(['refunded', 'failed']);

export interface PurchaseTrackingInput {
  /** The order's `paymentStatus` (`awaiting_payment` | `paid` | `deferred` | …). */
  paymentStatus: string;
  /** The order's `paymentMethod.kind`. */
  paymentKind: string;
}

export function shouldTrackPurchase({
  paymentStatus,
  paymentKind,
}: PurchaseTrackingInput): boolean {
  if (NON_CONVERTING_STATUSES.has(paymentStatus)) return false;
  if (paymentStatus === 'paid') return true;
  // An unrecognised kind is not in the closed `PaymentMethodKind` contract; the
  // safe answer to a surprise is to wait for confirmation, not to invent it.
  return DEFERRED_SETTLEMENT_KINDS.has(paymentKind);
}

/**
 * The `<PurchaseTracker>` payload for `order`, or `null` when this order may
 * not be counted. This is the checkout Success Page's whole tracker decision,
 * kept out of the page so it can be exercised directly — the tracker itself
 * renders `null`, so no amount of `renderToString` can tell whether it fired.
 */
export function purchaseTrackingPayload(order: OrderSummary): GaPurchase | null {
  if (!shouldTrackPurchase({ paymentStatus: order.paymentStatus, paymentKind: order.paymentMethod.kind })) {
    return null;
  }
  return {
    transactionId: order.businessId,
    value: order.total,
    currency: order.currency,
    items: order.items.map((it) => ({
      sku: it.productSnapshot.sku,
      name: it.productSnapshot.name,
      price: it.unitPrice,
      quantity: it.quantity,
      currency: order.currency,
    })),
  };
}
