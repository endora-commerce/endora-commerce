import {
  allocateHalfUp,
  compareDecimals,
  decimalProduct,
  grossFromNetHalfUp,
  lineAmountHalfUp,
  moneyDifference,
  moneySum,
  quotientHalfUp,
  roundHalfUp,
  vatByRate,
} from '@endora-commerce/contracts';

/**
 * Refund math — pure domain (feature 046, US5 / FR-031/032).
 *
 * The default refund for a returned quantity is what was paid for it, by a
 * cumulative rule over all the order's returns ({@link caseDefaultRefunds}). The approved amount
 * an admin settles per line may never exceed that default; the case total is the
 * sum of the approved per-line amounts.
 *
 * Exact decimal arithmetic (issue #417): an amount is read as the decimal it is
 * written as and rounded half-up on its decimal digits, where the binary
 * rounding made a typed 1.005 the refund 1.00. Results that cross into the
 * contract are numbers holding a two-place decimal, losslessly.
 */

/** An approved amount as it is capped, summed and stored: two places, half-up. */
export function approvedAmount(value: string | number): string {
  return roundHalfUp(value);
}

/** One line of the order, as the refund rule reads it. */
export interface RefundOrderLine {
  orderItemId: string;
  /** Net unit price, as stored. */
  unitNetPrice: string;
  /** VAT rate as a fraction, as stored. */
  taxRate: string;
  purchasedQty: number;
  /** The line's stored gross (`order_items.line_total`). */
  paidLineAmount: string;
  /** Whether the line may be returned; only returnable lines enter the rule. */
  returnable: boolean;
}

/**
 * **The default refund of each line of a case — cumulative** (issue #417,
 * review of PR #423, owner ruling of 2026-10-24).
 *
 * What an order charged is split into groups: under the per-rate VAT method
 * (`vatMethod: 'per_rate'`, an order placed from 0.108.0) one group per VAT
 * rate, worth the rate's net sum plus the VAT on it (`vatByRate`); for an order
 * placed before it (`vatMethod: null`), one group per line, worth the line's
 * stored gross. For each group, the refund of this case is
 *
 *     (the group's amount for everything returned so far, this case included)
 *   − (what earlier returns already refunded in that group),
 *
 * where "the amount for a quantity" is `vatByRate` over the returned nets (per
 * rate) or the stored line gross in proportion to the returned quantity (per
 * line). The differences telescope: any sequence of returns sums to the group's
 * amount for what came back, never more. On top, the case is capped at what
 * remains of the order's `productsPaidTotal`, and a return that completes the
 * order — every line returnable and every unit back — refunds exactly what
 * remains of it. Only returnable lines enter; a non-returnable line named by a
 * complaint gets, as the cap an operator may approve up to, its own amount for
 * the quantity, outside the groups. A group's refund is shared over the case's
 * lines in it in proportion to their nets (`allocateHalfUp`, exact shares).
 * Two-place decimal strings, in the order of `current`.
 */
export function caseDefaultRefunds(input: {
  vatMethod: 'per_rate' | null;
  productsPaidTotal: string;
  orderLines: readonly RefundOrderLine[];
  /** Lines of the order's earlier, live cases, with the default refund each recorded. */
  earlier: ReadonlyArray<{ orderItemId: string; quantity: number; defaultRefundAmount: string }>;
  current: ReadonlyArray<{ orderItemId: string; quantity: number }>;
}): string[] {
  const lineById = new Map(input.orderLines.map((l) => [l.orderItemId, l]));
  const perRate = input.vatMethod === 'per_rate';
  const groupOf = (l: RefundOrderLine): string => (perRate ? roundHalfUp(l.taxRate, 4) : l.orderItemId);
  const returnable = input.orderLines.filter((l) => l.returnable);

  // Quantities returned before this case, and after it, per returnable line.
  const before = new Map<string, number>();
  const refundedBefore = new Map<string, string[]>();
  for (const e of input.earlier) {
    const line = lineById.get(e.orderItemId);
    if (!line?.returnable) continue;
    before.set(e.orderItemId, (before.get(e.orderItemId) ?? 0) + e.quantity);
    const group = groupOf(line);
    const amounts = refundedBefore.get(group) ?? [];
    amounts.push(e.defaultRefundAmount);
    refundedBefore.set(group, amounts);
  }
  const after = new Map(before);
  for (const c of input.current) {
    if (lineById.get(c.orderItemId)?.returnable) after.set(c.orderItemId, (after.get(c.orderItemId) ?? 0) + c.quantity);
  }

  /** A group's amount for the quantities `returned`. */
  const groupAmount = (group: string, returned: ReadonlyMap<string, number>): string => {
    const lines = returnable.filter((l) => groupOf(l) === group);
    if (perRate) {
      const nets = lines.map((l) => lineAmountHalfUp(l.unitNetPrice, Math.min(returned.get(l.orderItemId) ?? 0, l.purchasedQty)));
      return vatByRate(nets.map((net) => ({ net, rate: group })), 'fraction').gross;
    }
    const line = lines[0]!;
    const quantity = Math.min(returned.get(line.orderItemId) ?? 0, line.purchasedQty);
    return quotientHalfUp(decimalProduct(line.paidLineAmount, quantity), line.purchasedQty);
  };

  const groups = [...new Set(input.current.flatMap((c) => {
    const line = lineById.get(c.orderItemId);
    return line?.returnable ? [groupOf(line)] : [];
  }))];
  const groupRefund = new Map<string, string>();
  for (const group of groups) {
    const due = moneyDifference(groupAmount(group, after), moneySum(refundedBefore.get(group) ?? []));
    groupRefund.set(group, compareDecimals(due, 0) < 0 ? '0.00' : due);
  }

  // The order-level cap, and the completing return.
  const refundedSoFar = moneySum([...refundedBefore.values()].flat());
  const remainingPaid = moneyDifference(input.productsPaidTotal, refundedSoFar);
  const completes =
    returnable.length === input.orderLines.length &&
    returnable.every((l) => (after.get(l.orderItemId) ?? 0) >= l.purchasedQty);
  const raw = moneySum([...groupRefund.values()]);
  const target = completes ? remainingPaid : compareDecimals(raw, remainingPaid) > 0 ? remainingPaid : raw;
  const caseTotal = compareDecimals(target, 0) < 0 ? '0.00' : target;
  // Hand the cap's (or the completion's) difference to the largest group, then the next.
  let delta = moneyDifference(caseTotal, raw);
  for (const group of [...groups].sort((a, b) => compareDecimals(groupRefund.get(b)!, groupRefund.get(a)!))) {
    if (compareDecimals(delta, 0) === 0) break;
    const adjusted = moneySum([groupRefund.get(group)!, delta]);
    const floored = compareDecimals(adjusted, 0) < 0 ? '0.00' : adjusted;
    delta = moneyDifference(delta, moneyDifference(floored, groupRefund.get(group)!));
    groupRefund.set(group, floored);
  }

  // Each group's refund over the case's lines in it, in proportion to their nets.
  const out: string[] = input.current.map(() => '0.00');
  for (const group of groups) {
    const indexes = input.current.flatMap((c, i) => {
      const line = lineById.get(c.orderItemId);
      return line?.returnable && groupOf(line) === group ? [i] : [];
    });
    const nets = indexes.map((i) => {
      const c = input.current[i]!;
      return lineAmountHalfUp(lineById.get(c.orderItemId)!.unitNetPrice, c.quantity);
    });
    const netSum = moneySum(nets);
    const refund = groupRefund.get(group)!;
    const parts =
      compareDecimals(netSum, 0) === 0
        ? nets.map((_, k) => (k === 0 ? refund : '0'))
        : nets.map((n) => quotientHalfUp(decimalProduct(refund, n), netSum, 6));
    allocateHalfUp(refund, parts).forEach((share, k) => {
      out[indexes[k]!] = share;
    });
  }
  // A non-returnable line (a complaint): its own amount, the cap an operator approves up to.
  input.current.forEach((c, i) => {
    const line = lineById.get(c.orderItemId);
    if (!line || line.returnable) return;
    out[i] = perRate
      ? grossFromNetHalfUp(lineAmountHalfUp(line.unitNetPrice, c.quantity), line.taxRate, 'fraction')
      : quotientHalfUp(decimalProduct(line.paidLineAmount, c.quantity), line.purchasedQty);
  });
  return out;
}

/**
 * True when an approved amount, at the two places it would be stored at,
 * exceeds the line's paid cap. This replaced a half-cent tolerance on doubles,
 * which let 100.005 through against a 100.00 cap.
 */
export function exceedsCap(approved: string | number, cap: string | number): boolean {
  return compareDecimals(approvedAmount(approved), cap) > 0;
}

/** Case total = sum of the approved per-line amounts, each at two places. */
export function sumApproved(amounts: ReadonlyArray<string | number>): number {
  return Number(moneySum(amounts.map(approvedAmount)));
}
