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
 * charged decides). What remains is `productsPaidTotal` less what the earlier
 * cases refunded by default, less `refundedOutside`.
 *
 * Which cases are `earlier` is the kept state (issues #874 and #875,
 * `kept-state.ts`): the lines of the order's `return` cases settled with a
 * refund or a credit — at settlement — or, for the figure shown when a case is
 * created, also its live returns not settled yet. A complaint is a price
 * reduction of goods the buyer keeps (issue #885), so it is never `earlier`:
 * the money a settled complaint moved enters only the order-level cap, as
 * `refundedOutside`.
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
  /** Lines of the order's cases in the kept state (`kept-state.ts`), with the default refund and discount each recorded. */
  earlier: ReadonlyArray<KeptStateLine>;
  current: ReadonlyArray<{ orderItemId: string; quantity: number }>;
  /**
   * The unabsorbed part of the money settled outside the kept state —
   * complaints refunded or credited (issue #874) — that what remains paid is
   * lowered by ({@link effectiveDefaultRefunds}). Two places; `0` when absent.
   */
  refundedOutside?: string;
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
  const remainingPaid = moneyDifference(
    moneyDifference(input.productsPaidTotal, refundedSoFar),
    roundHalfUp(input.refundedOutside ?? '0'),
  );
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

/** One line of a case in the kept state, as {@link caseDefaultRefunds} reads it. */
export interface KeptStateLine {
  orderItemId: string;
  quantity: number;
  defaultRefundAmount: string;
  defaultDiscountAmount: string;
}

/** The order facts the default refund is computed from, as {@link caseDefaultRefunds} reads them. */
export interface RefundOrder {
  vatMethod: 'per_rate' | null;
  productsPaidTotal: string;
  discountTotal?: string;
  orderLines: readonly RefundOrderLine[];
}

/**
 * What one line of the order was paid, under the kept-state rule (the #885
 * amendment, §4): the default refund of the whole line coming back, with
 * nothing else returned — its share of its group less the discount that share
 * carries. The bound no line's refunds, complaints and returns together, exceed.
 */
export function lineValue(order: RefundOrder, orderItemId: string): string {
  const line = order.orderLines.find((l) => l.orderItemId === orderItemId);
  if (!line) return '0.00';
  return caseDefaultRefunds({ ...order, earlier: [], current: [{ orderItemId, quantity: line.purchasedQty }] })[0]!.refund;
}

/**
 * **The default refund of each line of a case, with the per-line ceiling**
 * (issues #874 and #875, the #885 amendment §4, product-owner ruling E-C of
 * 2026-11-07).
 *
 * A complaint that moved money is a price reduction of goods the buyer keeps,
 * so it is not in the kept state: a later return of the same line still gets
 * the full default of the goods coming back. Without a bound, a complaint and
 * the returns of one line could then refund more than the line was paid — on
 * an order of several VAT rates the order-level cap does not bound one line.
 * So, per line `l`:
 *
 *   ceiling(l) = max(0, lineValue(l) − Σ stored defaults of the kept-state
 *                lines naming l − Σ complaint money on l)
 *
 * and the **effective default** of a return line is its default bounded by the
 * ceiling when a complaint moved money on the line; a complaint line is always
 * bounded by it. The first units back get their full default and the last ones
 * absorb the cut (ruling E-C): the platform cannot know which unit came back,
 * and the operator lowers the amount by hand when it is the defective one. A
 * line named twice in one case takes the ceiling in the order of the case.
 *
 * `refund` and `discount` stay the default of the goods, which is what the
 * settlement stores: they are the telescoping `earlier` of the next case, which
 * a capped figure would hand the cut back to. `effective` is what may be
 * refunded, and `ceiling` is set wherever the ceiling applied to the line.
 *
 * The order-level cap (`refundedOutside`) is lowered by **the unabsorbed part**
 * of the complaint money only: once the ceiling has cut a return by a
 * complaint's amount, that amount is inside the line's stored defaults and is
 * not counted twice. Per line, `max(0, min(complaint money, lineValue − Σ
 * stored defaults))` (architect's ruling on PR #937). With no complaint money
 * this is exactly {@link caseDefaultRefunds}.
 */
export function effectiveDefaultRefunds(
  input: RefundOrder & {
    earlier: ReadonlyArray<KeptStateLine>;
    /** The approved amounts of the lines of complaints settled with money, the case being settled excluded. */
    complaints: ReadonlyArray<{ orderItemId: string; amount: string }>;
    kind: 'return' | 'complaint';
    current: ReadonlyArray<{ orderItemId: string; quantity: number }>;
  },
): Array<{ refund: string; discount: string; effective: string; ceiling: string | null }> {
  const order: RefundOrder = {
    vatMethod: input.vatMethod,
    productsPaidTotal: input.productsPaidTotal,
    ...(input.discountTotal !== undefined ? { discountTotal: input.discountTotal } : {}),
    orderLines: input.orderLines,
  };
  const sumBy = (rows: ReadonlyArray<{ orderItemId: string }>, amount: (row: never) => string) => {
    const out = new Map<string, string>();
    for (const row of rows) out.set(row.orderItemId, moneySum([out.get(row.orderItemId) ?? '0', amount(row as never)]));
    return out;
  };
  const complaintMoney = sumBy(input.complaints, (c: { amount: string }) => c.amount);
  const keptDefaults = sumBy(input.earlier, (e: KeptStateLine) => e.defaultRefundAmount);
  const values = new Map<string, string>();
  const valueOf = (orderItemId: string): string => {
    let value = values.get(orderItemId);
    if (value === undefined) {
      value = lineValue(order, orderItemId);
      values.set(orderItemId, value);
    }
    return value;
  };

  // What of the complaint money the line's kept-state defaults have not absorbed.
  const outside = [...complaintMoney].map(([orderItemId, money]) => {
    const room = moneyDifference(valueOf(orderItemId), keptDefaults.get(orderItemId) ?? '0');
    const absorbed = compareDecimals(money, room) <= 0 ? money : room;
    return compareDecimals(absorbed, 0) < 0 ? '0.00' : absorbed;
  });
  const defaults = caseDefaultRefunds({
    ...order,
    earlier: input.earlier,
    current: input.current,
    refundedOutside: moneySum(outside),
  });

  const room = new Map<string, string>();
  return input.current.map((c, i) => {
    const { refund, discount } = defaults[i]!;
    const bound = input.kind === 'complaint' || compareDecimals(complaintMoney.get(c.orderItemId) ?? '0', 0) > 0;
    if (!bound) return { refund, discount, effective: refund, ceiling: null };
    let left = room.get(c.orderItemId);
    if (left === undefined) {
      const ceiling = moneyDifference(
        moneyDifference(valueOf(c.orderItemId), keptDefaults.get(c.orderItemId) ?? '0'),
        complaintMoney.get(c.orderItemId) ?? '0',
      );
      left = compareDecimals(ceiling, 0) < 0 ? '0.00' : ceiling;
    }
    const effective = compareDecimals(refund, left) <= 0 ? refund : left;
    room.set(c.orderItemId, moneyDifference(left, effective));
    return { refund, discount, effective, ceiling: left };
  });
}

/**
 * What a settlement approves for one line, once its default is recomputed
 * under the order's lock (issue #875). `requested` is the amount the operator
 * sent, or the stored approved amount for a line the request leaves out.
 *
 * - An amount equal to a default — the one stored at creation, the recomputed
 *   one, or the effective one the line ceiling leaves — is the default
 *   approved, and settles at the effective default.
 * - Otherwise an amount at most the effective default is the operator's, and
 *   is kept as typed.
 * - Anything else is more than may be refunded: `refund_exceeds_paid`, with
 *   nothing written; the operator reloads the form and confirms.
 *
 * `zeroIsAmount`: a non-returnable complaint line starts at an approved 0 for
 * the operator to set (feature 155, owner ruling R1), so its 0 is an amount and
 * is never read as a default approved.
 */
export function settlementApproved(input: {
  requested: string | number;
  previousDefault: string | number;
  recomputedDefault: string | number;
  effectiveDefault: string | number;
  zeroIsAmount: boolean;
}): { approved: string } | { refused: 'refund_exceeds_paid' } {
  const requested = approvedAmount(input.requested);
  const effective = approvedAmount(input.effectiveDefault);
  const isZeroAmount = input.zeroIsAmount && compareDecimals(requested, 0) === 0;
  const isDefault =
    !isZeroAmount &&
    [input.previousDefault, input.recomputedDefault, input.effectiveDefault].some(
      (d) => compareDecimals(requested, approvedAmount(d)) === 0,
    );
  if (isDefault) return { approved: effective };
  if (compareDecimals(requested, effective) <= 0) return { approved: requested };
  return { refused: 'refund_exceeds_paid' };
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
  if (compareDecimals(defaultDiscount, 0) <= 0) return '0.00';
  // A line whose discount share takes its whole value refunds 0.00 by default
  // and still gave its discount back (review of PR #865, F2): approved as it
  // is, it carries the whole default discount. Nothing scales from a 0.00 default.
  if (compareDecimals(defaultRefund, 0) <= 0) {
    return compareDecimals(approvedAmount(approved), approvedAmount(defaultRefund)) === 0 ? roundHalfUp(defaultDiscount) : '0.00';
  }
  return quotientHalfUp(decimalProduct(defaultDiscount, approved), defaultRefund);
}
