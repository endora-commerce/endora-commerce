import { compareDecimals, moneyDifference, roundHalfUp } from '@endora-commerce/contracts';
import { isWithinFreeWindow } from './free-return-window.js';
import { STATUTORY_WITHDRAWAL_DAYS } from './withdrawal-period.js';

/**
 * The order's charges a return refunds — pure domain (issue #876).
 *
 * On a consumer's withdrawal the trader reimburses **all payments received,
 * including the costs of delivery** (Directive 2011/83 art. 13(1), PL art. 32
 * ust. 1), and "all payments" takes in the payment surcharge as well (owner
 * ruling E3 of 2026-11-07). The platform applies it as an operator default, not
 * a locked figure: the operator lowers it where art. 13(2) applies — a premium
 * delivery the consumer chose over the cheapest standard one, which the
 * platform does not record — but never raises it above what was paid.
 *
 * A case refunds the charges when all four hold:
 *  1. the order's Organization is personal (B2C) — a business customer's return
 *     is a commercial return, not a statutory withdrawal;
 *  2. the case is a `return`, not a complaint;
 *  3. it **completes** the withdrawal: with this case, every unit of every line
 *     is back in the kept state (`kept-state.ts`). A partial withdrawal refunds
 *     neither charge, and the operator cannot add them (owner ruling E1);
 *  4. for the *default*: it was opened within the withdrawal window — the
 *     statutory 14 days, or the channel's longer free-return window (owner
 *     ruling E2). Outside it the default is 0 and the operator may still refund
 *     up to the cap.
 *
 * Conditions 1–3 decide the **cap**: what was paid for each charge less what
 * earlier cases already refunded of it, and 0 when they do not hold. Condition
 * 4 decides whether the **default** is the cap or 0. The goods' rule
 * (`refund-math.ts`) is untouched: the charges never enter it and do not change
 * its cap, so the order-level invariant is "money refunded ≤ the order total".
 */

/** The two charges, as two-place decimal strings. */
export interface OrderCharges {
  delivery: string;
  surcharge: string;
}

/** One charge's refund on a case: the most that may be approved, and the default. */
export interface ChargeRefund {
  cap: string;
  default: string;
}

export interface ChargeRefundInput {
  /** The order's Organization is personal (B2C). */
  isPersonal: boolean;
  kind: 'return' | 'complaint';
  /** With this case, every unit of every line is back ({@link completesOrder}). */
  completes: boolean;
  /** The case was opened within the withdrawal window ({@link isWithinWithdrawalWindow}). */
  withinWindow: boolean;
  /** What the order charged. */
  paid: OrderCharges;
  /** What earlier cases already refunded of each. */
  refundedBefore: OrderCharges;
}

const ZERO = '0.00';

function capOf(paid: string, refundedBefore: string): string {
  const left = moneyDifference(roundHalfUp(paid), roundHalfUp(refundedBefore));
  return compareDecimals(left, 0) < 0 ? ZERO : left;
}

/** The cap and the default of each charge on a case (the four conditions above). */
export function chargeRefunds(input: ChargeRefundInput): { delivery: ChargeRefund; surcharge: ChargeRefund } {
  const inScope = input.isPersonal && input.kind === 'return' && input.completes;
  const one = (paid: string, before: string): ChargeRefund => {
    const cap = inScope ? capOf(paid, before) : ZERO;
    return { cap, default: input.withinWindow ? cap : ZERO };
  };
  return {
    delivery: one(input.paid.delivery, input.refundedBefore.delivery),
    surcharge: one(input.paid.surcharge, input.refundedBefore.surcharge),
  };
}

/**
 * Whether a case completes the withdrawal: every unit of every order line is
 * back, counting the kept-state cases before it (`earlier`) and this case
 * (`current`). A line nobody may return — one not returnable at purchase —
 * keeps the order incomplete, so such an order never refunds its charges, which
 * is consistent with art. 16 / PL art. 38: the contract cannot be withdrawn
 * from in full.
 */
export function completesOrder(
  lines: ReadonlyArray<{ orderItemId: string; purchasedQty: number }>,
  earlier: ReadonlyArray<{ orderItemId: string; quantity: number }>,
  current: ReadonlyArray<{ orderItemId: string; quantity: number }>,
): boolean {
  if (lines.length === 0) return false;
  const back = new Map<string, number>();
  for (const e of [...earlier, ...current]) back.set(e.orderItemId, (back.get(e.orderItemId) ?? 0) + e.quantity);
  return lines.every((l) => (back.get(l.orderItemId) ?? 0) >= l.purchasedQty);
}

/**
 * Whether a case was opened within the withdrawal window (owner ruling E2): the
 * channel's free-return window (`freeReturnEligible`, which an operator may set
 * longer than 14 days), or the statutory 14 days, which no setting removes — a
 * channel with `free_return_days = 0` still has it. Counted as #936 counts the
 * withdrawal period (`withdrawal-period.ts`): from `withdrawalPeriodAnchor`, in
 * calendar days of `returns.time_zone`, a last day on a weekend moving to the
 * Monday.
 *
 * Deliberately not `isWithinStatutoryPeriod`, which answers `true` while the
 * period has not started: with no anchor this answers `false`, so the default
 * never applies on an order that was not completed (it cannot fail open).
 */
export function isWithinWithdrawalWindow(input: {
  freeReturnEligible: boolean;
  submittedAt: Date;
  /** `withdrawalPeriodAnchor(ctx)`; `null` = the order has not been completed. */
  completingAt: Date | null;
  /** `returns.time_zone` for the order's channel. */
  timeZone: string;
}): boolean {
  return (
    input.freeReturnEligible ||
    isWithinFreeWindow(input.submittedAt, input.completingAt, STATUTORY_WITHDRAWAL_DAYS, input.timeZone)
  );
}

/**
 * What a settlement approves for one charge, once it is recomputed under the
 * order's lock (ruling Q2 on PR #965):
 *
 * - an omitted amount takes the recomputed default;
 * - a present amount at most the cap settles exactly as sent, 0 included;
 * - a present amount above the cap is `refund_exceeds_paid`, with nothing
 *   written — a stale figure above a cap that has since shrunk included.
 *
 * This deliberately differs from the goods' rule (`settlementApproved`), where
 * an amount equal to a default stored at creation means "the default approved":
 * a charge sent as 0 means no refund of it.
 */
export function chargeApproved(input: {
  requested?: string | number | undefined;
  recomputed: ChargeRefund;
}): { approved: string } | { refused: 'refund_exceeds_paid' } {
  if (input.requested === undefined) return { approved: roundHalfUp(input.recomputed.default) };
  const requested = roundHalfUp(input.requested);
  if (compareDecimals(requested, input.recomputed.cap) <= 0) return { approved: requested };
  return { refused: 'refund_exceeds_paid' };
}
