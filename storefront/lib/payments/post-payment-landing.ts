import type { PaymentReturnOutcome } from '@endora-commerce/contracts';

/**
 * Where a buyer lands once a payment gateway hands them back (issue #287).
 *
 * The owner's ruling: **a correct payment shows the success page, a failed one
 * the failure page** — for every gateway, whether or not it has a hook per
 * outcome. PayU's `continueUrl` and Autopay's `ReturnURL` are single URLs used
 * for every outcome, so that ruling cannot be expressed in gateway
 * configuration at all. The platform therefore decides *after* the buyer
 * lands: `/checkout/return` accepts every gateway's hand-back, reads the
 * order's own payment state, and forwards.
 *
 * That makes the decision one function, and this is it. It is pure so the
 * auth-gated pages do not have to be mounted to exercise it, and so the same
 * rule can be re-applied by the success and failure pages themselves — each of
 * them is a URL a buyer can bookmark, share and replay, and neither may go on
 * asserting an outcome the order has since moved past.
 *
 * The gateway's hint is trusted **downwards only**: a hint of `failed` or
 * `cancelled` shows the failure page before our own notification has landed,
 * which costs nothing (that page offers to pay this order again and re-reads
 * the order every time), while no hint may produce a success — a success page
 * fires the purchase conversion, and a replayed URL must never buy revenue.
 */

/** Why the failure page is being shown for an order that exists. */
export type PaymentFailureReason = 'failed' | 'cancelled';

export type PostPaymentLanding =
  | { kind: 'success' }
  | { kind: 'failure'; reason: PaymentFailureReason }
  | { kind: 'pending' };

export interface PostPaymentLandingInput {
  /** The order's `paymentStatus` (`awaiting_payment` | `paid` | `failed` | …). */
  paymentStatus: string;
  /** The order's `paymentMethod.kind`. */
  paymentKind: string;
  /** The gateway's own hint, from the return URL. Never authoritative. */
  outcome?: string | undefined;
}

/**
 * Payment kinds whose settlement is arranged outside the checkout session.
 *
 * Same three as the purchase-conversion rule in `lib/analytics/purchase-eligibility.ts`,
 * asked a different question: there it is "may this count as revenue yet",
 * here it is "is there a confirmation still coming while the buyer waits". For
 * a bank transfer, a cash-on-pickup order and a credit-limit draw the answer
 * is no in both cases, and waiting would be waiting for nothing.
 */
const DEFERRED_SETTLEMENT_KINDS = new Set(['bank_transfer', 'pickup', 'credit_limit']);

/** Payment statuses that mean the money question is closed. */
const SETTLED_STATUSES = new Set(['paid', 'deferred', 'refunded']);

export function resolvePostPaymentLanding({
  paymentStatus,
  paymentKind,
  outcome,
}: PostPaymentLandingInput): PostPaymentLanding {
  // The order's own state first, and it beats every hint. `refunded` is here
  // deliberately: the money did settle, the refund is a later event the order
  // page tells, and there is nothing for the buyer to pay again.
  if (SETTLED_STATUSES.has(paymentStatus)) return { kind: 'success' };
  if (paymentStatus === 'failed') return { kind: 'failure', reason: 'failed' };
  // Nothing is in flight for an out-of-band settlement, so the buyer is done.
  if (DEFERRED_SETTLEMENT_KINDS.has(paymentKind)) return { kind: 'success' };
  if (outcome === 'failed') return { kind: 'failure', reason: 'failed' };
  if (outcome === 'cancelled') return { kind: 'failure', reason: 'cancelled' };
  // The buyer is back before the gateway's confirmation. Their money may be in
  // flight, so the honest answer is "we are checking", never "it failed".
  return { kind: 'pending' };
}

/**
 * The gateway's hint, narrowed to the three values the landing understands.
 *
 * Anything else — absent, misspelled, hand-edited — reads as `returned`, the
 * value that asserts nothing: the order's own payment state then decides
 * alone. A hint can only ever bring the failure page forward, so an unreadable
 * one must not be able to.
 */
export function parseReturnOutcome(raw: string | undefined): PaymentReturnOutcome {
  return raw === 'cancelled' || raw === 'failed' ? raw : 'returned';
}

/** The success page for `orderId`. */
export function checkoutSuccessUrl(orderId: string): string {
  return `/checkout/success?id=${encodeURIComponent(orderId)}`;
}

/**
 * The failure page **for an order that exists** — the `id` is what tells that
 * page it is not looking at a placement failure, so it must not promise the
 * cart was kept or offer a button that places a second order.
 */
export function paymentFailureUrl(orderId: string, reason: PaymentFailureReason): string {
  return `/checkout/failure?id=${encodeURIComponent(orderId)}&outcome=${reason}`;
}

/** The landing every gateway hook points at. */
export function paymentReturnUrl(
  orderId: string,
  outcome: PaymentReturnOutcome,
  attempt?: number,
): string {
  const base = `/checkout/return?id=${encodeURIComponent(orderId)}&outcome=${outcome}`;
  return attempt && attempt > 0 ? `${base}&attempt=${attempt}` : base;
}

/**
 * Where `/checkout/return` sends this buyer, or `null` to stay and wait.
 *
 * The whole forwarding decision, so the page around it is a session, a read
 * and a redirect — and so the claim "a paid PayU return lands on the success
 * page" can be asserted from the URL PayU was handed, without mounting an
 * auth-gated server component.
 */
export function postPaymentDestination(
  order: { id: string; paymentStatus: string; paymentMethod: { kind: string } },
  outcome: PaymentReturnOutcome,
): string | null {
  const landing = resolvePostPaymentLanding({
    paymentStatus: order.paymentStatus,
    paymentKind: order.paymentMethod.kind,
    outcome,
  });
  if (landing.kind === 'success') return checkoutSuccessUrl(order.id);
  if (landing.kind === 'failure') return paymentFailureUrl(order.id, landing.reason);
  return null;
}

/**
 * How long the platform keeps looking for a confirmation before it stops
 * refreshing on the buyer's behalf.
 *
 * Bounded, because a gateway that never confirms would otherwise leave a
 * browser reloading a page for the rest of the day. Spending the budget does
 * **not** turn the wait into a failure — the page keeps saying the payment is
 * being confirmed and stops re-fetching by itself, leaving the buyer a manual
 * check and the promise of an e-mail.
 */
export const PENDING_POLL_INTERVAL_MS = 3_000;
export const PENDING_POLL_MAX_ATTEMPTS = 10;

/**
 * The attempt counter carried in the landing URL. Anything unusable — absent,
 * negative, not a number — reads as the first look; anything above the budget
 * is clamped to it, so a hand-edited URL cannot ask for an unbounded wait.
 */
export function parsePollAttempt(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, PENDING_POLL_MAX_ATTEMPTS);
}

/**
 * The next look at this landing, or `null` once the budget is spent.
 */
export function nextPendingPoll(
  orderId: string,
  outcome: PaymentReturnOutcome,
  attempt: number,
): { url: string; delayMs: number } | null {
  if (attempt >= PENDING_POLL_MAX_ATTEMPTS) return null;
  return {
    url: paymentReturnUrl(orderId, outcome, attempt + 1),
    delayMs: PENDING_POLL_INTERVAL_MS,
  };
}
