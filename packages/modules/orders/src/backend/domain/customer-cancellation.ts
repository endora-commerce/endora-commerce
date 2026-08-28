/**
 * When a buyer may cancel an order they placed (feature 085 Phase F, FR-013 to
 * FR-015; derived in `specs/085-payment-failure-recovery/research.md` R13, and
 * corrected by the owner's ruling on issue #284).
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
 * 2. **Nobody has begun to fulfil the order**: the order is at the graph's
 *    initial status, or it is at the status the payment method fails into
 *    **and the settlement ingress is what put it there**.
 *
 * Term 2 exists because term 1 is unsafe on its own. Bank transfer and cash on
 * pickup never advance their money axis — nothing moves it but an operator
 * marking the money received, and that route writes `paymentStatus` and never
 * `order.status` — so a money-only rule lets a buyer cancel goods already
 * picked, packed and shipped, which under Phase D releases the stock those
 * goods were dispatched against.
 *
 * ## What issue #284 changed, and why
 *
 * Term 2's second clause used to be the status comparison **alone**: "the order
 * stands where the ingress would have put it". That was meant to separate an
 * order held by a decline from one an operator held mid-fulfilment, and R13
 * claimed it did — but Phase C then set `status_on_failure = 'on_hold'` for
 * every shipped method, and on that default the two orders are identical in
 * every column the predicate reads: same `status`, same `paymentStatus`, same
 * configured failure status. The operator's hold therefore handed the buyer a
 * cancel control, and cancelling it releases stock the warehouse may already
 * have picked.
 *
 * The difference between the two orders is not a state, it is an **event**, and
 * since Phase D there is a record of it: every transition writes an
 * `order.status_transition` audit entry carrying its actor. So the clause now
 * asks who wrote the hold, and the caller supplies the answer —
 * see `status-authorship.ts` for what the recorded entry can and cannot say.
 *
 * **The status comparison stays, in conjunction rather than alone.** It is no
 * longer the discriminator it failed to be; it is what keeps a *shipment*-driven
 * status out. The shipment ingress announces itself as a system actor too, and
 * an order it moved to `shipment_sent` is an order the shop has dispatched —
 * authorship alone would admit it, which is the same hazard wearing the other
 * hat.
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
  /**
   * Whether the order's **current** status was written by a system actor —
   * which, at a payment method's failure status, is the settlement ingress
   * (issue #284).
   *
   * Established from the order's transition history by
   * `authorOfCurrentStatus`; `false` covers both "an operator or the customer
   * wrote it" and "nothing in the history says", and the two are deliberately
   * one value here because the answer to both is the same. The caller batches
   * that read for a whole page and hands the decision the boolean, so this
   * function stays synchronous and cannot issue a query of its own.
   */
  currentStatusWrittenBySystem: boolean;
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
 * Term 2 — nobody has begun to fulfil the order.
 *
 * Two ways to satisfy it, and the second one is a conjunction of three facts:
 * the method's failure status is readable, the order is at it, and a system
 * actor is what put the order there. Drop any of the three and a case that
 * must be refused gets through — an unreadable configuration guessed at, a
 * shipped order that a system actor moved, an operator's hold on the shipped
 * default where every column agrees with a decline's.
 *
 * Deliberately **not** a membership test against `{initial, on_hold}`, and no
 * longer the status comparison on its own: see the header.
 */
export function shopHasNotStarted(inputs: ShopHasNotStartedInputs): boolean {
  if (inputs.status === inputs.initialStatusCode) return true;
  if (inputs.statusOnFailure === null || inputs.status !== inputs.statusOnFailure) return false;
  return inputs.currentStatusWrittenBySystem;
}

/** Both terms. The server decides this; the buyer's surface is told the answer. */
export function isBuyerCancellable(inputs: BuyerCancellableInputs): boolean {
  return stillOwedByTheBuyer(inputs.paymentStatus) && shopHasNotStarted(inputs);
}
