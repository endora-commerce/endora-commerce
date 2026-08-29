/**
 * Whether the order page offers the buyer a way to cancel (feature 085, US3).
 *
 * **This deliberately decides nothing.** The capability is computed by the
 * platform and carried on the order read as `customerCancellable`, and the one
 * job of this function is to read it and refuse to guess when it is absent.
 *
 * The rule has two terms — the buyer still owes the money themselves, and the
 * shop has not started — and the second needs the configured order-status graph
 * and the payment method's configured failure status. Neither is here, neither
 * should be sent here, and a storefront that re-derived the first term alone
 * would offer a cancel button on an order the shop had already shipped: bank
 * transfer and cash on pickup sit at `awaiting_payment` indefinitely, so the
 * money axis says "unpaid" long after the goods have left. That is exactly the
 * shape the payment-retry work already found on this page, where a hard-coded
 * `order.status === 'completed' || order.status === 'cancelled'` had drifted
 * from the server.
 *
 * Absent (an older cached payload, a response shape that changed) reads as
 * `false`: not offering a control the server would have accepted is a smaller
 * failure than offering one it will refuse.
 */
export function offersCancellation(order: { customerCancellable?: boolean }): boolean {
  return order.customerCancellable === true;
}
