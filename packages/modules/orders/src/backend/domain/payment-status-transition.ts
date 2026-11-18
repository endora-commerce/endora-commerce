import {
  paymentStatusTargets,
  type OrderPaymentStatusRefusalDetails,
  type PaymentStatus,
  type PaymentStatusTransitionActor,
} from '@endora-commerce/contracts';

/**
 * Whether an order's payment status may move from `from` to `to` (issue #1574).
 *
 * The graph is `PAYMENT_STATUS_TRANSITIONS` in `@endora-commerce/contracts`, so
 * the admin dialog offers exactly what this function lets through. Its two
 * callers are both this module's: `OrderService.transitionPaymentStatus` (the
 * operator, on the locked row) and `OrderPaymentStatusApplyService` (settlement,
 * on the caller's transaction).
 *
 * - `apply` — an edge of the graph; write it.
 * - `unchanged` — the order is already there; write nothing, audit nothing,
 *   owe nothing (the twin of `OrderTransitionService.apply`'s `from === to`).
 * - `refused` — not an edge. `token` is the sentence a refusal is explained
 *   by: `payment_refunded` out of `refunded`, `payment_not_paid` into
 *   `refunded` from a status nothing was paid in, `null` for every other move,
 *   none of which an operator can ask for (the route's schema refuses it first).
 *
 * Pure, so the rule can be read and tested without a database.
 */
export type PaymentStatusDecision =
  | { readonly kind: 'apply' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'refused'; readonly token: OrderPaymentStatusRefusalDetails['code'] | null };

const UNPAID: ReadonlySet<string> = new Set<PaymentStatus>(['awaiting_payment', 'failed', 'deferred']);

export function decidePaymentStatusChange(
  from: PaymentStatus | string,
  to: PaymentStatus,
  actor: PaymentStatusTransitionActor,
): PaymentStatusDecision {
  if (from === to) return { kind: 'unchanged' };
  if (paymentStatusTargets(from, actor).includes(to)) return { kind: 'apply' };
  if (from === 'refunded') return { kind: 'refused', token: 'payment_refunded' };
  if (to === 'refunded' && UNPAID.has(from)) return { kind: 'refused', token: 'payment_not_paid' };
  return { kind: 'refused', token: null };
}
