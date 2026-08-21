/**
 * When a buyer may cancel an order they placed (feature 085 Phase F, FR-013 to
 * FR-015; derived in `specs/085-payment-failure-recovery/research.md` R13).
 *
 * The owner's ruling is one sentence with two clauses — *"the customer may
 * cancel only orders that have not yet been paid. Beyond that the order is
 * being processed and only a platform administrator may cancel it"* — and both
 * clauses are operative. Hence two terms, neither of which is sufficient alone:
 *
 * 1. **The buyer still owes the money themselves.** An allow-list of two, never
 *    a negation of `paid`: a credit-limit order is `deferred`, which is
 *    literally unpaid and would pass a negation, but its credit was drawn
 *    inside the placement transaction — the shop is already acting on it.
 * 2. **Nobody has begun to fulfil the order**, expressed as "the order is still
 *    where the payment flow left it": the graph's initial status, or the status
 *    the payment method's own `statusOnFailure` setting points at.
 *
 * Term 2 exists because term 1 is unsafe on its own. Bank transfer and cash on
 * pickup never advance their money axis — nothing moves it but an operator
 * marking the money received, and that route writes `paymentStatus` and never
 * `order.status` — so a money-only rule lets a buyer cancel goods already
 * picked, packed and shipped, which under Phase D releases the stock those
 * goods were dispatched against.
 *
 * Pure, and free of any status literal: both comparison values are passed in
 * because both are operator-configurable. The caller reads the initial status
 * from the configured graph and the failure status from the payment method the
 * order was placed with.
 */

/**
 * The payment states in which the buyer still owes this money themselves.
 *
 * The same allow-list `PaymentRetryService.BUYER_STILL_OWES` and the
 * storefront's `offersPaymentRetry` apply, and for the same reason: `deferred`
 * is unpaid by arrangement and `refunded` is settled the other way.
 */
const BUYER_STILL_OWES: ReadonlySet<string> = new Set(['awaiting_payment', 'failed']);

/** The lifecycle half of the question, with both configured values supplied. */
export interface ShopHasNotStartedInputs {
  /** The order's current lifecycle status code. */
  status: string;
  /** The configured graph's initial status — `isInitial`, not the literal `new`. */
  initialStatusCode: string;
  /**
   * The `statusOnFailure` of the payment method the order was placed with.
   *
   * `null` when it cannot be read — `payment_methods` switched off, or a method
   * retired since placement. The term then rests on the initial status alone,
   * which fails closed: a held order stops being buyer-cancellable rather than
   * every held order becoming so.
   */
  statusOnFailure: string | null;
}

export interface BuyerCancellableInputs extends ShopHasNotStartedInputs {
  /** The order's money axis. */
  paymentStatus: string;
}

/** Term 1 — the money axis, as an allow-list of two (R13). */
export function stillOwedByTheBuyer(paymentStatus: string): boolean {
  return BUYER_STILL_OWES.has(paymentStatus);
}

/**
 * Term 2 — the order is still where the payment flow left it.
 *
 * Deliberately **not** a membership test against `{initial, on_hold}`. An order
 * an operator moved to `on_hold` from mid-fulfilment was moved by an actor
 * after the payment flow left it: the shop chose to hold it, and the shop had
 * already started. Comparing to the method's *configured* failure status is
 * what tells those two `on_hold` orders apart — **whenever the two statuses
 * differ**.
 *
 * Under the shipped default they do not, and research R13 claims more for this
 * formulation than it can deliver. A method that fails into `on_hold` produces
 * an order whose columns are identical whether a decline put it there or an
 * operator did: same status, same money axis, same configured failure status.
 * So on the shipped configuration a mid-fulfilment hold **is** buyer-cancellable,
 * and the buyer releasing it releases stock a shop that had started may have
 * committed. Separating the two needs the order's *history* — who moved it last
 * — which the ruled predicate does not read and which is a design change rather
 * than a fix: it would make a buyer-facing capability depend on audit rows.
 * Recorded here rather than papered over; it is the owner's to decide.
 */
export function shopHasNotStarted(inputs: ShopHasNotStartedInputs): boolean {
  if (inputs.status === inputs.initialStatusCode) return true;
  return inputs.statusOnFailure !== null && inputs.status === inputs.statusOnFailure;
}

/** Both terms. The server decides this; the buyer's surface is told the answer. */
export function isBuyerCancellable(inputs: BuyerCancellableInputs): boolean {
  return stillOwedByTheBuyer(inputs.paymentStatus) && shopHasNotStarted(inputs);
}
