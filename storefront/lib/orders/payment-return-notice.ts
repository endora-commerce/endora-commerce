import type { MessageKey } from '../i18n/messages';

/**
 * What to tell a buyer the order page just received back from a gateway
 * (issue #274).
 *
 * All four gateways now return the buyer to `/orders/:id?payment=<outcome>`.
 * The marker is a hint for the copy and nothing more: it rides in a URL the
 * buyer can bookmark, share or replay, so the order's own `paymentStatus`
 * decides whether there is anything to say at all. A buyer who reloads a
 * `?payment=failed` link after the notification landed is not told their paid
 * order failed.
 */
const NOTICES: Record<string, MessageKey> = {
  returned: 'orders.paymentReturn.returned',
  cancelled: 'orders.paymentReturn.cancelled',
  failed: 'orders.paymentReturn.failed',
};

/**
 * The payment states in which the buyer still owes this money themselves, and
 * a return marker therefore still describes where the order stands.
 *
 * `failed` is one of them, and it is the one this notice exists for. The guard
 * used to be `paymentStatus !== 'awaiting_payment'`, which read as *settled one
 * way or another* — true while the platform could not produce a failed payment,
 * and false from feature 085 onwards, when a decline started writing `failed`.
 * Left as it was, the `?payment=failed` notice would have been suppressed for
 * exactly the buyer a gateway redirects here.
 *
 * `deferred`, `paid` and `refunded` stay out: each of them is settled, so a
 * bookmarked or replayed `?payment=` link has nothing left to say.
 */
const STILL_UNSETTLED = new Set(['awaiting_payment', 'failed']);

export function resolvePaymentReturnNotice(
  marker: string | undefined,
  paymentStatus: string,
): MessageKey | null {
  if (!marker) return null;
  // The payment is settled one way or another — the return marker is stale.
  if (!STILL_UNSETTLED.has(paymentStatus)) return null;
  return NOTICES[marker] ?? null;
}
