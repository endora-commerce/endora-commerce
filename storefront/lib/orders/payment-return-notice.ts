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

export function resolvePaymentReturnNotice(
  marker: string | undefined,
  paymentStatus: string,
): MessageKey | null {
  if (!marker) return null;
  // The payment is settled one way or another — the return marker is stale.
  if (paymentStatus !== 'awaiting_payment') return null;
  return NOTICES[marker] ?? null;
}
