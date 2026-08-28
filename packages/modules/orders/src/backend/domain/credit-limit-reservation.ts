/**
 * Whether an order can possibly hold a credit-limit reservation — decided from
 * state `orders` owns, without asking `credit_limits` anything.
 *
 * A reservation is created in exactly one place: the `kind === 'credit_limit'`
 * branch of `OrderService.placeOrder`, which calls `CreditLimitPort.reserve`
 * inside the placement transaction. The same `paymentMethod.kind` that gates
 * that branch is stamped into `paymentMethodSnapshot` on the row being placed,
 * and the snapshot is deliberately immutable history — later edits to the
 * payment method never rewrite it. So an order whose snapshot says anything
 * else provably drew no credit, and the release paths have nothing to release.
 *
 * That is the whole point of this predicate (D-179.3). `releaseByOrder` used to
 * be called unconditionally on the transitions to `paid` and to `cancelled`,
 * which was harmless while the port answered `RESERVATION_NOT_FOUND` — a value
 * both call sites discard — and became a defect the moment the edge was
 * classified `refuses-without`: with `credit_limits` switched off the gated
 * port raises `ModuleDisabledError`, so *every* order refused those two
 * transitions rather than only the ones paid on credit.
 *
 * The remedy is not to catch that refusal (AGENTS.md composition item 7): an
 * order that really did draw credit must still refuse, because its credit
 * cannot be given back while the owner is absent. It is to stop asking a
 * question this module already knows the answer to.
 */
export function mayHoldCreditLimitReservation(order: {
  paymentMethodSnapshot?: { kind?: string } | null;
}): boolean {
  return order.paymentMethodSnapshot?.kind === 'credit_limit';
}
