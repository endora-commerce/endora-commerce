/**
 * Who wrote an order's current status, read back from its transition history
 * (issue #284).
 *
 * Feature 085 wanted to tell "held by a declined payment" apart from "held by
 * an operator mid-fulfilment" and tried to do it with the columns the order
 * carries. It cannot be done that way: Phase C set `status_on_failure` to
 * `on_hold` for every shipped payment method, so the two orders have the same
 * `status`, the same `paymentStatus` and the same configured failure status.
 * The difference between them is not a state, it is an **event** — and since
 * Phase D routed the settlement ingress through `OrderTransitionService`, every
 * status change leaves an `order.status_transition` audit entry recorded
 * co-transactionally with the write.
 *
 * ## The rule
 *
 * Read on the latest entry (or entries) for the status the order is at:
 *
 * 1. **`stateAfter.source === 'payment'` is the payment settlement ingress,
 *    whoever the actor was** — `system` from a gateway callback, or the
 *    administrator who recorded a decline through `POST /api/v1/payments/receive`.
 *    The code is set only by server-side callers of `orderCommandPort`
 *    (`specs/186-aggregate-ports/` R-4, R-18.2): no HTTP body reaches it, which
 *    is what makes trusting it safe (`backend/test/contract/orders/order-command-port.source-boundary.test.ts`).
 * 2. Otherwise **any named actor column means `named_actor`**:
 *    `actorAdminUserId` (an administrator), `impersonatedCustomerAccountId`
 *    (an administrator acting for a customer, or — before 0.113.0 — the buyer
 *    themselves), or `actorCustomerAccountId` (a customer acting for
 *    themselves, as the Command Bus records it since 0.113.0).
 * 3. All three null is a `system` actor — on an order at a payment method's
 *    failure status, the settlement ingress of an entry written before the
 *    ingress named itself.
 *
 * Any other `source` (`shipment`, an integration's code) does not make an
 * entry the ingress's; a shipment-driven status written by the system actor is
 * still `system` here, and the caller keeps the configured `statusOnFailure`
 * comparison beside this answer, which is what keeps it out. See
 * `shopHasNotStarted`.
 *
 * ## Why authorship is decided on the whole set at one instant
 *
 * `actedAt` is set when the entry is constructed and there is no sequence
 * column, so two entries can share the latest instant. Rather than pick one
 * arbitrarily, every entry at that instant has to agree; anything else is
 * `unknown`, which the caller fails closed on.
 */

/** One `order.status_transition` entry, reduced to what authorship needs. */
export interface StatusTransitionRecord {
  /** The order the entry was recorded against (`objectId`). */
  orderId: string;
  actedAt: Date;
  /** `stateAfter.status` — `null` when the entry carries no readable status. */
  statusAfter: string | null;
  actorAdminUserId: string | null;
  impersonatedCustomerAccountId: string | null;
  /**
   * The Customer Account that acted for itself. Since 0.113.0 the transition
   * is a Command (`specs/186-aggregate-ports/` US4), whose bus records a buyer's
   * own cancellation here; the hand audit before it put the buyer in
   * `impersonatedCustomerAccountId`. Either names an actor. Optional so an
   * entry read before the column was filled still compiles.
   */
  actorCustomerAccountId?: string | null;
  /**
   * `stateAfter.source` — the code a caller of `orderCommandPort` names itself
   * with (`specs/186-aggregate-ports/` R-4). `payment` is the settlement
   * ingress whoever its ambient actor was (research R-18.2). Optional: entries
   * written before 0.113.0 carry none.
   */
  source?: string | null;
}

/**
 * - `system` — the latest entry names neither an admin user nor a customer
 *   account, so a `{ kind: 'system' }` actor wrote it. On an order at a payment
 *   method's failure status, that actor is the settlement ingress.
 * - `named_actor` — an administrator or the customer themselves wrote it.
 * - `unknown` — there is no history, or the history does not describe the
 *   status the order is actually at. Both mean the same thing to a caller that
 *   must not guess.
 */
export type StatusAuthor = 'system' | 'named_actor' | 'unknown';

/** The `source` code the payment settlement ingress records its status moves under. */
export const SETTLEMENT_SOURCE = 'payment';

/**
 * The author of `currentStatus`, from this order's entries.
 *
 * `unknown` when the entries are empty (an order whose hold predates Phase D,
 * or whose history has been trimmed) and when the latest entry describes some
 * *other* status than the one the order is at — which means a write that did
 * not go through the transition seam has happened since, and the history no
 * longer describes the order.
 */
export function authorOfCurrentStatus(
  records: readonly StatusTransitionRecord[],
  currentStatus: string,
): StatusAuthor {
  if (records.length === 0) return 'unknown';

  let latestAt = -Infinity;
  for (const record of records) latestAt = Math.max(latestAt, record.actedAt.getTime());
  const latest = records.filter((record) => record.actedAt.getTime() === latestAt);

  if (latest.some((record) => record.statusAfter !== currentStatus)) return 'unknown';
  // The settlement ingress names itself since 0.113.0; before, it was told
  // apart only by recording no actor. An operator recording a decline through
  // the ingress (`POST /api/v1/payments/receive`) is still the ingress.
  if (latest.every((record) => record.source === SETTLEMENT_SOURCE)) return 'system';
  const named = latest.some(
    (record) =>
      record.actorAdminUserId !== null ||
      record.impersonatedCustomerAccountId !== null ||
      (record.actorCustomerAccountId ?? null) !== null,
  );
  return named ? 'named_actor' : 'system';
}

/**
 * The same answer for a page, from one flat list of entries.
 *
 * The list is what a single batched read hands back; the grouping happens here,
 * in memory, so the per-order decision is given the answer rather than an
 * accessor it could go behind. Ids with no entry are present in the result as
 * `unknown` — an absent key and a key holding `unknown` would otherwise be two
 * spellings of the same fact.
 */
export function currentStatusAuthors(
  records: Iterable<StatusTransitionRecord>,
  currentStatusByOrder: ReadonlyMap<string, string>,
): Map<string, StatusAuthor> {
  const byOrder = new Map<string, StatusTransitionRecord[]>();
  for (const record of records) {
    const bucket = byOrder.get(record.orderId);
    if (bucket) bucket.push(record);
    else byOrder.set(record.orderId, [record]);
  }

  const authors = new Map<string, StatusAuthor>();
  for (const [orderId, currentStatus] of currentStatusByOrder) {
    authors.set(orderId, authorOfCurrentStatus(byOrder.get(orderId) ?? [], currentStatus));
  }
  return authors;
}
