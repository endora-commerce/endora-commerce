import {
  allocateHalfUp,
  compareDecimals,
  decimalProduct,
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
  /** Whether the line may be returned; a complaint may name one that may not, and it enters the rule all the same. */
  returnable: boolean;
}

/**
 * **The default refund of each line of a case — cumulative** (issue #417,
 * review of PR #423, owner ruling of 2026-10-24).
 *
 * What an order charged for its products (`productsPaidTotal`: subtotal + tax −
 * discount, as stored) is split into groups: under the per-rate VAT method
 * (`vatMethod: 'per_rate'`) one group per VAT rate, worth the rate's net sum
 * plus the VAT on it (`vatByRate`); for an order placed before it (`null`), one
 * group per line, worth the line's stored gross. **Every line enters** — a
 * complaint on a line that was not returnable as much as a return — so no
 * combination of returns and complaints refunds more than was paid.
 *
 * The order-level discount (taken off the gross without tax of its own) is
 * shared over the groups in proportion to their amounts, and a group carries
 * its share in proportion to the part of it. For each group of an order placed
 * per rate, the refund of this case is the drop in the kept goods' value
 * (issue #435, product-owner ruling Q1 (c) of 2026-11-07):
 *
 *     (the group's amount, less its discount share, less what earlier cases
 *      already refunded in it)
 *   − (`vatByRate` over the nets kept after this case, less the discount the
 *      kept part carries),
 *
 * so what is left paid is exactly what an invoice of the kept goods charges,
 * and the discount the case carries is the drop in the kept part's discount,
 * against what earlier cases recorded. For an order placed before 0.108.0 the
 * refund is the stored line gross of everything returned so far, this case
 * included, in proportion and less the discount that part carries, minus what
 * earlier cases already refunded. The differences telescope. On top, the case is capped at what remains of
 * `productsPaidTotal`, and a case that completes the order — every unit of
 * every line back — refunds exactly what remains of it: what the order charged,
 * the same target the correction credits (for an order placed before 0.108.0
 * the stored lines may add up to a cent off `productsPaidTotal`; the money
 * charged decides).
 *
 * Each line's answer is its `refund` and the `discount` that refund carries —
 * what a correction credits back on the invoice's discount line. A group's
 * refund and discount are shared over the case's lines in it in proportion to
 * their nets (`allocateHalfUp`, exact shares). Two-place decimal strings, in
 * the order of `current`.
 */
export function caseDefaultRefunds(input: {
  vatMethod: 'per_rate' | null;
  productsPaidTotal: string;
  /** The order-level discount, as stored. */
  discountTotal?: string;
  orderLines: readonly RefundOrderLine[];
  /** Lines of the order's earlier, live cases — returns and complaints — with the default refund and discount each recorded. */
  earlier: ReadonlyArray<{ orderItemId: string; quantity: number; defaultRefundAmount: string; defaultDiscountAmount: string }>;
  current: ReadonlyArray<{ orderItemId: string; quantity: number }>;
}): Array<{ refund: string; discount: string }> {
  const lineById = new Map(input.orderLines.map((l) => [l.orderItemId, l]));
  const perRate = input.vatMethod === 'per_rate';
  const groupOf = (l: RefundOrderLine): string => (perRate ? roundHalfUp(l.taxRate, 4) : l.orderItemId);
  const lines = input.orderLines;

  // Quantities returned before this case, and after it, per line.
  const before = new Map<string, number>();
  const refundedBefore = new Map<string, string[]>();
  const carriedBefore = new Map<string, string[]>();
  const push = (into: Map<string, string[]>, group: string, amount: string) => {
    const amounts = into.get(group);
    if (amounts) amounts.push(amount);
    else into.set(group, [amount]);
  };
  for (const e of input.earlier) {
    const line = lineById.get(e.orderItemId);
    if (!line) continue;
    before.set(e.orderItemId, (before.get(e.orderItemId) ?? 0) + e.quantity);
    const group = groupOf(line);
    push(refundedBefore, group, e.defaultRefundAmount);
    push(carriedBefore, group, e.defaultDiscountAmount);
  }
  const after = new Map(before);
  for (const c of input.current) {
    if (lineById.has(c.orderItemId)) after.set(c.orderItemId, (after.get(c.orderItemId) ?? 0) + c.quantity);
  }

  const groupLines = new Map<string, RefundOrderLine[]>();
  for (const l of lines) {
    const group = groupOf(l);
    const members = groupLines.get(group);
    if (members) members.push(l);
    else groupLines.set(group, [l]);
  }
  /** A group's amount for the quantities `returned`, before the discount. */
  const groupAmount = (group: string, returned: ReadonlyMap<string, number>): string => {
    const members = groupLines.get(group) ?? [];
    if (perRate) {
      const nets = members.map((l) => lineAmountHalfUp(l.unitNetPrice, Math.min(returned.get(l.orderItemId) ?? 0, l.purchasedQty)));
      return vatByRate(nets.map((net) => ({ net, rate: group })), 'fraction').gross;
    }
    const line = members[0]!;
    const quantity = Math.min(returned.get(line.orderItemId) ?? 0, line.purchasedQty);
    return quotientHalfUp(decimalProduct(line.paidLineAmount, quantity), line.purchasedQty);
  };

  // The discount shared over the groups in proportion to their full amounts.
  const allGroups = [...groupLines.keys()];
  const purchased = new Map(lines.map((l) => [l.orderItemId, l.purchasedQty]));
  const full = new Map(allGroups.map((g) => [g, groupAmount(g, purchased)]));
  const fullSum = moneySum([...full.values()]);
  const discount = roundHalfUp(input.discountTotal ?? '0');
  const shares =
    compareDecimals(discount, 0) > 0 && compareDecimals(fullSum, 0) > 0
      ? allocateHalfUp(
          discount,
          allGroups.map((g) => quotientHalfUp(decimalProduct(discount, full.get(g)!), fullSum, 6)),
        )
      : allGroups.map(() => '0.00');
  const discountOf = new Map(allGroups.map((g, i) => [g, shares[i]!]));
  /** The discount a group's amount for `returned` carries. */
  const groupDiscount = (group: string, returned: ReadonlyMap<string, number>): string => {
    const total = full.get(group)!;
    if (compareDecimals(total, 0) <= 0) return '0.00';
    return quotientHalfUp(decimalProduct(discountOf.get(group)!, groupAmount(group, returned)), total);
  };

  const groups = [...new Set(input.current.flatMap((c) => {
    const line = lineById.get(c.orderItemId);
    return line ? [groupOf(line)] : [];
  }))];
  const groupRefund = new Map<string, string>();
  const groupDiscountNow = new Map<string, string>();
  // What is kept of each line after this case, for the per-rate rule.
  const keptAfter = new Map(lines.map((l) => [l.orderItemId, Math.max(0, l.purchasedQty - (after.get(l.orderItemId) ?? 0))]));
  for (const group of groups) {
    let due: string;
    let carried: string;
    if (perRate) {
      // Issue #435, product-owner ruling Q1 (c): the refund is the drop in the
      // kept goods' value. What is left paid in the group after this case is
      // what an invoice of the kept goods charges — VAT per rate on the kept
      // nets, less the discount the kept part carries — so the order, the
      // kept-lines invoice and the payment agree to the cent. Taken against
      // what earlier cases recorded, so a cent an earlier case refunded under
      // the rule before this one is absorbed here. The discount the case
      // carries is the drop in the kept part's discount, the same way.
      const share = discountOf.get(group)!;
      const keptDiscount = groupDiscount(group, keptAfter);
      const keptValue = moneyDifference(groupAmount(group, keptAfter), keptDiscount);
      const paidLeft = moneyDifference(
        moneyDifference(full.get(group)!, share),
        moneySum(refundedBefore.get(group) ?? []),
      );
      due = moneyDifference(paidLeft, keptValue);
      carried = moneyDifference(moneyDifference(share, keptDiscount), moneySum(carriedBefore.get(group) ?? []));
    } else {
      // An order placed before 0.108.0 keeps the rule of its day: the stored
      // line gross of everything returned so far, less what was refunded.
      const discountAfter = groupDiscount(group, after);
      due = moneyDifference(
        moneyDifference(groupAmount(group, after), discountAfter),
        moneySum(refundedBefore.get(group) ?? []),
      );
      carried = moneyDifference(discountAfter, groupDiscount(group, before));
    }
    groupRefund.set(group, compareDecimals(due, 0) < 0 ? '0.00' : due);
    groupDiscountNow.set(group, compareDecimals(carried, 0) < 0 ? '0.00' : carried);
  }

  // The order-level cap, and the completing case.
  const refundedSoFar = moneySum([...refundedBefore.values()].flat());
  const remainingPaid = moneyDifference(input.productsPaidTotal, refundedSoFar);
  const completes = lines.every((l) => (after.get(l.orderItemId) ?? 0) >= l.purchasedQty);
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

  // Each group's refund and discount over the case's lines in it, by their nets.
  const out = input.current.map(() => ({ refund: '0.00', discount: '0.00' }));
  for (const group of groups) {
    const indexes = input.current.flatMap((c, i) => {
      const line = lineById.get(c.orderItemId);
      return line && groupOf(line) === group ? [i] : [];
    });
    const nets = indexes.map((i) => {
      const c = input.current[i]!;
      return lineAmountHalfUp(lineById.get(c.orderItemId)!.unitNetPrice, c.quantity);
    });
    const netSum = moneySum(nets);
    const split = (amount: string) =>
      allocateHalfUp(
        amount,
        compareDecimals(netSum, 0) === 0
          ? nets.map((_, k) => (k === 0 ? amount : '0'))
          : nets.map((n) => quotientHalfUp(decimalProduct(amount, n), netSum, 6)),
      );
    const refunds = split(groupRefund.get(group)!);
    const discounts = split(groupDiscountNow.get(group)!);
    indexes.forEach((lineIndex, k) => {
      out[lineIndex] = { refund: refunds[k]!, discount: discounts[k]! };
    });
  }
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

/**
 * The discount an approved amount carries (issue #417): the line's default
 * discount in proportion to how much of its default refund was approved. What
 * the settlement tells the correction, so the goods are credited at
 * `approved + discount` and the discount comes back on the invoice's discount line.
 */
export function carriedDiscount(
  defaultDiscount: string | number,
  defaultRefund: string | number,
  approved: string | number,
): string {
  if (compareDecimals(defaultRefund, 0) <= 0 || compareDecimals(defaultDiscount, 0) <= 0) return '0.00';
  return quotientHalfUp(decimalProduct(defaultDiscount, approved), defaultRefund);
}
