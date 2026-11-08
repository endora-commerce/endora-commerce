import { describe, expect, it } from 'vitest';
import { decimalSum, grossFromNetHalfUp, lineAmountHalfUp, moneyDifference, roundHalfUp, taxAmountExact, vatByRate } from '@endora-commerce/contracts';
import {
  carriedDiscount,
  caseDefaultRefunds,
  effectiveDefaultRefunds,
  lineValue,
  settlementApproved,
  type RefundOrderLine,
} from './refund-math.js';

/**
 * Review of PR #423, owner ruling of 2026-10-24 (issue #417) — the default
 * refund of a return is **cumulative**: for each group of what was paid (a VAT
 * rate of an order placed under the per-rate method; a line of an order placed
 * before it), the amount of everything returned so far, this case included,
 * minus what earlier returns already refunded in that group; capped at what
 * remains paid. So no sequence of returns refunds more than the order charged,
 * and a complete return refunds exactly what it charged.
 */
const cents = (value: string) => Math.round(Number(value) * 100);

/** A deterministic generator, so a failure names a seed that reproduces it. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

interface Order {
  vatMethod: 'per_rate' | null;
  productsPaidTotal: string;
  discountTotal: string;
  lines: RefundOrderLine[];
}

function randomOrder(next: () => number, vatMethod: 'per_rate' | null, withDiscount = false, discountUpTo = 0.5): Order {
  const rates = ['0.23', '0.08', '0.05', '0'];
  const lines: RefundOrderLine[] = Array.from({ length: 1 + Math.floor(next() * 4) }, (_, i) => {
    const unitNetPrice = roundHalfUp((1 + Math.floor(next() * 5000)) / 100);
    const purchasedQty = 1 + Math.floor(next() * 5);
    const taxRate = rates[Math.floor(next() * rates.length)]!;
    const net = lineAmountHalfUp(unitNetPrice, purchasedQty);
    return {
      orderItemId: `line-${i}`,
      unitNetPrice,
      taxRate,
      purchasedQty,
      // Under the per-rate method the stored line total is the line's own rounding;
      // before it, it was the same per-line rounding of the gross.
      paidLineAmount: grossFromNetHalfUp(net, taxRate, 'fraction'),
      // Some lines are not returnable: a complaint names them, and it counts all the same.
      returnable: next() < 0.75,
    };
  });
  const nets = lines.map((l) => ({ net: lineAmountHalfUp(l.unitNetPrice, l.purchasedQty), rate: l.taxRate }));
  // What the order charged for its products: per rate on the net sums, or —
  // before the per-rate method — the sum of the lines' exact taxes, rounded once.
  const productsPaidTotal =
    vatMethod === 'per_rate'
      ? vatByRate(nets, 'fraction').gross
      : roundHalfUp(
          decimalSum(
            ...nets.map((n) => n.net),
            roundHalfUp(decimalSum(...nets.map((n) => taxAmountExact(n.net, n.rate, 'fraction')))),
          ),
        );
  // An order-level discount of up to half the products (or `discountUpTo` of them), taken off the gross.
  const discountTotal = withDiscount ? roundHalfUp(Math.floor(next() * cents(productsPaidTotal) * discountUpTo) / 100) : '0.00';
  return { vatMethod, productsPaidTotal: moneyDifference(productsPaidTotal, discountTotal), discountTotal, lines };
}

/** Return everything in random partial cases; answer every case's refunds. */
function returnAll(order: Order, next: () => number): string[][] & { discounts: string[] } {
  const remaining = new Map(order.lines.map((l) => [l.orderItemId, l.purchasedQty]));
  const earlier: Array<{ orderItemId: string; quantity: number; defaultRefundAmount: string; defaultDiscountAmount: string }> = [];
  const cases: string[][] = [];
  const discounts: string[] = [];
  const lineById = new Map(order.lines.map((l) => [l.orderItemId, l]));
  while ([...remaining.values()].some((q) => q > 0)) {
    const current = order.lines
      .filter((l) => remaining.get(l.orderItemId)! > 0 && next() < 0.6)
      .map((l) => ({ orderItemId: l.orderItemId, quantity: 1 + Math.floor(next() * remaining.get(l.orderItemId)!) }));
    if (current.length === 0) continue;
    const refunds = caseDefaultRefunds({ ...order, orderLines: order.lines, earlier, current });
    current.forEach((c, i) => {
      remaining.set(c.orderItemId, remaining.get(c.orderItemId)! - c.quantity);
      earlier.push({ ...c, defaultRefundAmount: refunds[i]!.refund, defaultDiscountAmount: refunds[i]!.discount });
    });
    cases.push(refunds.map((r) => r.refund));
    discounts.push(...refunds.map((r) => r.discount));
    if (order.vatMethod === 'per_rate') {
      // Issue #435, ruling Q1 (c) and Q3 — after every case, what is left paid
      // is what an invoice of the kept goods charges: VAT per rate on the kept
      // nets, less the discount the refunds did not take back.
      const keptNets = order.lines.map((l) => ({
        net: lineAmountHalfUp(l.unitNetPrice, remaining.get(l.orderItemId)!),
        rate: l.taxRate,
      }));
      // The discount as the invoice reads it back: each case line's carried
      // discount at its default refund, approved as it is (review of PR #865, F2).
      const carried = earlier.map((e) => carriedDiscount(e.defaultDiscountAmount, e.defaultRefundAmount, e.defaultRefundAmount));
      const keptInvoice = moneyDifference(
        vatByRate(keptNets, 'fraction').gross,
        moneyDifference(order.discountTotal, decimalSum('0', ...carried)),
      );
      const paidLeft = moneyDifference(order.productsPaidTotal, decimalSum('0', ...cases.flat()));
      expect(paidLeft, `kept invoice ${keptInvoice} against ${paidLeft} left paid (${[...lineById.keys()].length} lines)`).toBe(
        keptInvoice,
      );
    }
  }
  return Object.assign(cases, { discounts });
}

describe('caseDefaultRefunds — the reviewer’s cases', () => {
  const order = (unitNetPrice: string, purchasedQty: number, taxRate: string): Order => {
    const net = lineAmountHalfUp(unitNetPrice, purchasedQty);
    return {
      vatMethod: 'per_rate',
      productsPaidTotal: vatByRate([{ net, rate: taxRate }], 'fraction').gross,
      discountTotal: '0.00',
      lines: [
        {
          orderItemId: 'a',
          unitNetPrice,
          taxRate,
          purchasedQty,
          paidLineAmount: grossFromNetHalfUp(net, taxRate, 'fraction'),
          returnable: true,
        },
      ],
    };
  };

  it('two returns of 1 × 1.07 at 23 % refund 1.31 + 1.32 = 2.63, what was paid — not 2.64', () => {
    const o = order('1.07', 2, '0.23');
    expect(o.productsPaidTotal).toBe('2.63');
    const first = caseDefaultRefunds({ ...o, orderLines: o.lines, earlier: [], current: [{ orderItemId: 'a', quantity: 1 }] });
    const second = caseDefaultRefunds({
      ...o,
      orderLines: o.lines,
      earlier: [{ orderItemId: 'a', quantity: 1, defaultRefundAmount: first[0]!.refund, defaultDiscountAmount: '0.00' }],
      current: [{ orderItemId: 'a', quantity: 1 }],
    });
    // Issue #435, ruling Q1 (c): the first refunds the drop in the kept goods'
    // value, 2.63 − 1.32 (1.07 kept, VAT 0.25), so the kept 1.32 is what is left paid.
    expect([first[0]!.refund, second[0]!.refund]).toEqual(['1.31', '1.32']);
  });

  it('two returns of 1 × 0.03 at 23 % refund 0.04 + 0.03 = 0.07, not 0.04 twice', () => {
    const o = order('0.03', 2, '0.23');
    expect(o.productsPaidTotal).toBe('0.07');
    const first = caseDefaultRefunds({ ...o, orderLines: o.lines, earlier: [], current: [{ orderItemId: 'a', quantity: 1 }] });
    const second = caseDefaultRefunds({
      ...o,
      orderLines: o.lines,
      earlier: [{ orderItemId: 'a', quantity: 1, defaultRefundAmount: first[0]!.refund, defaultDiscountAmount: first[0]!.discount }],
      current: [{ orderItemId: 'a', quantity: 1 }],
    });
    expect(cents(first[0]!.refund) + cents(second[0]!.refund)).toBe(7);
  });

  it('keeps a complaint inside the order’s accounting: a return and a complaint of 1 × 0.03 refund 0.07, not 0.08', () => {
    // Two lines at 23 %, one not returnable: 0.06 net, 0.01 VAT, 0.07 paid.
    const o: Order = {
      vatMethod: 'per_rate',
      productsPaidTotal: '0.07',
      discountTotal: '0.00',
      lines: [
        { orderItemId: 'a', unitNetPrice: '0.03', taxRate: '0.23', purchasedQty: 1, paidLineAmount: '0.04', returnable: true },
        { orderItemId: 'b', unitNetPrice: '0.03', taxRate: '0.23', purchasedQty: 1, paidLineAmount: '0.04', returnable: false },
      ],
    };
    const returned = caseDefaultRefunds({ ...o, orderLines: o.lines, earlier: [], current: [{ orderItemId: 'a', quantity: 1 }] });
    const complaint = caseDefaultRefunds({
      ...o,
      orderLines: o.lines,
      earlier: [{ orderItemId: 'a', quantity: 1, defaultRefundAmount: returned[0]!.refund, defaultDiscountAmount: returned[0]!.discount }],
      current: [{ orderItemId: 'b', quantity: 1 }],
    });
    // Issue #435, ruling Q1 (c): the return refunds the drop in the kept value, 0.07 − 0.04.
    expect([returned[0]!.refund, complaint[0]!.refund]).toEqual(['0.03', '0.04']);
  });

  it('refunds what the products were charged after an order-level discount: 73.00 of 83.00 captured, not 123.00', () => {
    // 100.00 net + 23.00 VAT, a 50.00 discount on the gross, 10.00 delivery: 83.00 captured.
    const o: Order = {
      vatMethod: 'per_rate',
      productsPaidTotal: '73.00',
      discountTotal: '50.00',
      lines: [{ orderItemId: 'a', unitNetPrice: '50.00', taxRate: '0.23', purchasedQty: 2, paidLineAmount: '123.00', returnable: true }],
    };
    const first = caseDefaultRefunds({ ...o, orderLines: o.lines, earlier: [], current: [{ orderItemId: 'a', quantity: 1 }] });
    const second = caseDefaultRefunds({
      ...o,
      orderLines: o.lines,
      earlier: [{ orderItemId: 'a', quantity: 1, defaultRefundAmount: first[0]!.refund, defaultDiscountAmount: first[0]!.discount }],
      current: [{ orderItemId: 'a', quantity: 1 }],
    });
    // Each half carries half the discount: 61.50 − 25.00, twice.
    expect([first[0], second[0]]).toEqual([
      { refund: '36.50', discount: '25.00' },
      { refund: '36.50', discount: '25.00' },
    ]);
  });
});

describe('caseDefaultRefunds — the refund is the drop in the kept goods’ value (#435, ruling Q1 (c))', () => {
  const single = (unitNetPrice: string, purchasedQty: number, discountTotal = '0.00'): Order => {
    const net = lineAmountHalfUp(unitNetPrice, purchasedQty);
    return {
      vatMethod: 'per_rate',
      productsPaidTotal: moneyDifference(vatByRate([{ net, rate: '0.23' }], 'fraction').gross, discountTotal),
      discountTotal,
      lines: [
        {
          orderItemId: 'a',
          unitNetPrice,
          taxRate: '0.23',
          purchasedQty,
          paidLineAmount: grossFromNetHalfUp(net, '0.23', 'fraction'),
          returnable: true,
        },
      ],
    };
  };
  type Earlier = Array<{ orderItemId: string; quantity: number; defaultRefundAmount: string; defaultDiscountAmount: string }>;
  const run = (o: Order, quantities: number[]) => {
    const earlier: Earlier = [];
    return quantities.map((quantity) => {
      const [r] = caseDefaultRefunds({ ...o, orderLines: o.lines, earlier, current: [{ orderItemId: 'a', quantity }] });
      earlier.push({ orderItemId: 'a', quantity, defaultRefundAmount: r!.refund, defaultDiscountAmount: r!.discount });
      return r!;
    });
  };

  it('3 × 10.01 at 23 %, 1 returned: refunds 12.32, so 24.62 is left paid — the kept invoice, 20.02 + 4.60', () => {
    const o = single('10.01', 3);
    expect(o.productsPaidTotal).toBe('36.94');
    const [first] = run(o, [1]);
    expect(first).toEqual({ refund: '12.32', discount: '0.00' });
    expect(moneyDifference(o.productsPaidTotal, first!.refund)).toBe(vatByRate([{ net: '20.02', rate: '0.23' }], 'fraction').gross);
  });

  it('two partial returns, then the completion, refund exactly what was paid', () => {
    const o = single('10.01', 3);
    const refunds = run(o, [1, 1, 1]).map((r) => r.refund);
    // Kept 24.62, then 12.31, then nothing.
    expect(refunds).toEqual(['12.32', '12.31', '12.31']);
    expect(decimalSum('0', ...refunds)).toBe('36.94');
  });

  it('a discounted order: the refund and the discount it carries leave the kept invoice equal to what is left paid', () => {
    // 30.03 net + 6.91 VAT = 36.94, a 6.94 discount: 30.00 paid for the goods.
    const o = single('10.01', 3, '6.94');
    const [first, second] = run(o, [1, 1]);
    // Kept after the first: 24.62 carrying 4.63 of the discount (6.94 × 24.62 / 36.94).
    expect(first).toEqual({ refund: '10.01', discount: '2.31' });
    expect(moneyDifference(o.productsPaidTotal, first!.refund)).toBe(moneyDifference('24.62', moneyDifference('6.94', '2.31')));
    // Kept after the second: 12.31 carrying 2.31 (6.94 × 12.31 / 36.94).
    expect(second).toEqual({ refund: '9.99', discount: '2.32' });
    expect(moneyDifference(o.productsPaidTotal, decimalSum(first!.refund, second!.refund))).toBe(
      moneyDifference('12.31', moneyDifference('6.94', decimalSum(first!.discount, second!.discount))),
    );
  });

  it('a 0.00 default refund still carries its discount back (review of PR #865, F2)', () => {
    // Two lines at 0 %, 0.01 and 0.05, a 0.05 discount: 0.01 paid. The 0.01 line comes back.
    const o: Order = {
      vatMethod: 'per_rate',
      productsPaidTotal: '0.01',
      discountTotal: '0.05',
      lines: [
        { orderItemId: 'a', unitNetPrice: '0.01', taxRate: '0', purchasedQty: 1, paidLineAmount: '0.01', returnable: true },
        { orderItemId: 'b', unitNetPrice: '0.05', taxRate: '0', purchasedQty: 1, paidLineAmount: '0.05', returnable: true },
      ],
    };
    const [r] = caseDefaultRefunds({ ...o, orderLines: o.lines, earlier: [], current: [{ orderItemId: 'a', quantity: 1 }] });
    expect(r).toEqual({ refund: '0.00', discount: '0.01' });
    // What the invoice reads back: the 0.05 kept, less 0.05 − 0.01 of discount, is the 0.01 paid.
    const carried = carriedDiscount(r!.discount, r!.refund, r!.refund);
    expect(moneyDifference('0.05', moneyDifference('0.05', carried))).toBe(moneyDifference(o.productsPaidTotal, r!.refund));
  });

  it('absorbs a cent an earlier case refunded under the rule before it', () => {
    // The first case was settled before the fix: 12.31, the returned unit's own value.
    const o = single('10.01', 3);
    const [second] = caseDefaultRefunds({
      ...o,
      orderLines: o.lines,
      earlier: [{ orderItemId: 'a', quantity: 1, defaultRefundAmount: '12.31', defaultDiscountAmount: '0.00' }],
      current: [{ orderItemId: 'a', quantity: 1 }],
    });
    // 36.94 − 12.31 − 12.31 kept: 12.32.
    expect(second!.refund).toBe('12.32');
  });
});

describe('caseDefaultRefunds — any sequence of partial returns (property)', () => {
  for (const [vatMethod, withDiscount, discountUpTo] of [
    ['per_rate', false, 0.5],
    [null, false, 0.5],
    ['per_rate', true, 0.5],
    [null, true, 0.5],
    // Review of PR #865 (F2): a discount of up to the whole products, where a
    // line's default refund can be 0.00 and still carry its discount.
    ['per_rate', true, 1],
  ] as const) {
    it(`never refunds more than was paid, and a complete return refunds it exactly (${vatMethod ?? 'legacy'}${withDiscount ? `, discounted up to ${discountUpTo * 100} %` : ''}, returns and complaints)`, () => {
      for (let seed = 1; seed <= 300; seed += 1) {
        const next = rng(seed);
        const order = randomOrder(next, vatMethod, withDiscount, discountUpTo);
        const cases = returnAll(order, next);
        let refunded = 0;
        for (const refunds of cases) {
          for (const r of refunds) {
            expect(cents(r), `seed ${seed}: a negative refund`).toBeGreaterThanOrEqual(0);
            refunded += cents(r);
          }
          expect(refunded, `seed ${seed}: refunded more than was paid`).toBeLessThanOrEqual(cents(order.productsPaidTotal));
        }
        expect(refunded, `seed ${seed}: a complete return`).toBe(cents(order.productsPaidTotal));
        // The discount the returns carried adds up to the order's discount, never more.
        expect(cases.discounts.reduce((sum, d) => sum + cents(d), 0), `seed ${seed}: the discount`).toBe(
          cents(order.discountTotal),
        );
      }
    });
  }
});

/**
 * Issues #874 and #875, and the per-line ceiling of the #885 amendment (§4).
 * The kept state is what settled `return` cases gave back for money; a
 * complaint that moved money is a price reduction of goods the buyer keeps, so
 * it leaves `earlier` and counts only against what is left paid
 * (`refundedOutside`), and against the line it names: no line refunds more,
 * complaints and returns together, than it was paid (`lineValue`). The first
 * units back get their full default and the last ones absorb the cut
 * (product-owner ruling E-C of 2026-11-07).
 */
describe('caseDefaultRefunds and the line ceiling — complaints outside the kept state (#874, #875)', () => {
  type Earlier = Array<{ orderItemId: string; quantity: number; defaultRefundAmount: string; defaultDiscountAmount: string }>;
  const line = (orderItemId: string, unitNetPrice: string, purchasedQty: number, taxRate: string, returnable = true): RefundOrderLine => ({
    orderItemId,
    unitNetPrice,
    taxRate,
    purchasedQty,
    paidLineAmount: grossFromNetHalfUp(lineAmountHalfUp(unitNetPrice, purchasedQty), taxRate, 'fraction'),
    returnable,
  });
  const order = (lines: RefundOrderLine[], discountTotal = '0.00'): Order => ({
    vatMethod: 'per_rate',
    productsPaidTotal: moneyDifference(
      vatByRate(lines.map((l) => ({ net: lineAmountHalfUp(l.unitNetPrice, l.purchasedQty), rate: l.taxRate })), 'fraction').gross,
      discountTotal,
    ),
    discountTotal,
    lines,
  });
  const bolts = order([line('A', '10.0100', 3, '0.23')]);
  /** A = 3 × 10.0100 at 23 %, B = 2 × 4.9950 at 8 %, a 5.00 order discount: 42.73 paid for the goods. */
  const twoRate = order([line('A', '10.0100', 3, '0.23'), line('B', '4.9950', 2, '0.08')], '5.00');
  const defaults = (
    o: Order,
    kind: 'return' | 'complaint',
    current: Array<{ orderItemId: string; quantity: number }>,
    earlier: Earlier = [],
    complaints: Array<{ orderItemId: string; amount: string }> = [],
  ) => effectiveDefaultRefunds({ ...o, orderLines: o.lines, earlier, complaints, kind, current });

  // Domain-level: under FR-033 a complaint takes up returnable quantity, so the 2-unit case of AC-885-2b is unreachable through the API.
  it('the order cap counts complaint money: 3 × 10.01, a complaint of 6.15, then 1 and 2 units (AC-885-2, 2b)', () => {
    expect(bolts.productsPaidTotal).toBe('36.94');
    const complaints = [{ orderItemId: 'A', amount: '6.15' }];
    const [first] = defaults(bolts, 'return', [{ orderItemId: 'A', quantity: 1 }], [], complaints);
    // The complaint is not in `earlier`: the return refunds the drop in the kept value, 12.32.
    expect(first).toMatchObject({ refund: '12.32', effective: '12.32' });
    const [rest] = defaults(
      bolts,
      'return',
      [{ orderItemId: 'A', quantity: 2 }],
      [{ orderItemId: 'A', quantity: 1, defaultRefundAmount: '12.32', defaultDiscountAmount: '0.00' }],
      complaints,
    );
    // 36.94 − 6.15 − 12.32 is what is left paid: the cap takes 24.62 down to 18.47.
    expect(rest).toMatchObject({ refund: '18.47', effective: '18.47' });
  });

  it('a complaint settled without money changes nothing: replaced, then 1 unit returned refunds 12.32 (#874)', () => {
    const [r] = defaults(bolts, 'return', [{ orderItemId: 'A', quantity: 1 }]);
    expect(r).toEqual({ refund: '12.32', discount: '0.00', effective: '12.32', ceiling: null });
  });

  it('a complaint refunded 12.32, then 1 unit returned: 12.32, and the cap still holds (#874)', () => {
    const [r] = defaults(bolts, 'return', [{ orderItemId: 'A', quantity: 1 }], [], [{ orderItemId: 'A', amount: '12.32' }]);
    expect(r).toMatchObject({ refund: '12.32', effective: '12.32', ceiling: '24.62' });
  });

  it('the line value is what the line was paid under the kept-state rule: A 33.07, B 9.66', () => {
    expect(twoRate.productsPaidTotal).toBe('42.73');
    const o = { ...twoRate, orderLines: twoRate.lines };
    expect([lineValue(o, 'A'), lineValue(o, 'B')]).toEqual(['33.07', '9.66']);
  });

  // Domain-level: under FR-033 a complaint takes up returnable quantity, so 3A after it is unreachable through the API; settlement-recompute.test.ts pins the reachable 22.05 → 22.04.
  it('AC-885-7 — a complaint of 6.15 on 1A, then all of A: 26.92 carrying 3.87, then 2B 9.66, closing at 0', () => {
    const complaints = [{ orderItemId: 'A', amount: '6.15' }];
    const [a] = defaults(twoRate, 'return', [{ orderItemId: 'A', quantity: 3 }], [], complaints);
    // The default is still the goods' value, and stays the stored figure; the ceiling binds.
    expect(a).toEqual({ refund: '33.07', discount: '3.87', effective: '26.92', ceiling: '26.92' });
    // Approved at the effective default, it carries its full default discount: the goods leave.
    const approved = settlementApproved({
      requested: a!.refund,
      previousDefault: a!.refund,
      recomputedDefault: a!.refund,
      effectiveDefault: a!.effective,
      zeroIsAmount: false,
    });
    expect(approved).toEqual({ approved: '26.92' });
    expect(carriedDiscount(a!.discount, a!.effective, '26.92')).toBe('3.87');
    const [b] = defaults(
      twoRate,
      'return',
      [{ orderItemId: 'B', quantity: 2 }],
      [{ orderItemId: 'A', quantity: 3, defaultRefundAmount: a!.refund, defaultDiscountAmount: a!.discount }],
      complaints,
    );
    expect(b).toEqual({ refund: '9.66', discount: '1.13', effective: '9.66', ceiling: null });
    // Line A: 6.15 + 26.92 = 33.07, what it was paid. Everything: 42.73.
    expect(decimalSum('6.15', '26.92')).toBe('33.07');
    expect(decimalSum('6.15', '26.92', b!.effective)).toBe(twoRate.productsPaidTotal);
  });

  it('the reachable binding: a complaint of 11.03 on 1A, then 2A: 22.04, a cent under the 22.05 default; then 2B 9.66', () => {
    // A complaint takes up returnable quantity, so after one on 1A only 2A can come back.
    const [complaint] = defaults(twoRate, 'complaint', [{ orderItemId: 'A', quantity: 1 }]);
    expect(complaint).toMatchObject({ refund: '11.03', discount: '1.29', effective: '11.03' });
    const complaints = [{ orderItemId: 'A', amount: '11.03' }];
    const [a] = defaults(twoRate, 'return', [{ orderItemId: 'A', quantity: 2 }], [], complaints);
    expect(a).toEqual({ refund: '22.05', discount: '2.58', effective: '22.04', ceiling: '22.04' });
    const [b] = defaults(
      twoRate,
      'return',
      [{ orderItemId: 'B', quantity: 2 }],
      [{ orderItemId: 'A', quantity: 2, defaultRefundAmount: a!.refund, defaultDiscountAmount: a!.discount }],
      complaints,
    );
    expect(b).toMatchObject({ refund: '9.66', effective: '9.66' });
    expect(decimalSum('11.03', a!.effective, b!.effective)).toBe(twoRate.productsPaidTotal);
  });

  it('E-C — a complaint of 6.15 on 1A, then 1A returned: the full default 11.03, no automatic reduction', () => {
    const [a] = defaults(twoRate, 'return', [{ orderItemId: 'A', quantity: 1 }], [], [{ orderItemId: 'A', amount: '6.15' }]);
    expect(a).toEqual({ refund: '11.03', discount: '1.29', effective: '11.03', ceiling: '26.92' });
    // The operator lowers it by hand when the defective unit itself came back.
    expect(
      settlementApproved({ requested: 4.88, previousDefault: '11.03', recomputedDefault: '11.03', effectiveDefault: '11.03', zeroIsAmount: false }),
    ).toEqual({ approved: '4.88' });
  });

  it('a complaint is bounded by its line: after 2A returned, a complaint on the last A refunds at most 11.02', () => {
    const [c] = defaults(
      twoRate,
      'complaint',
      [{ orderItemId: 'A', quantity: 1 }],
      [{ orderItemId: 'A', quantity: 2, defaultRefundAmount: '22.05', defaultDiscountAmount: '2.58' }],
    );
    expect(c).toMatchObject({ refund: '11.02', effective: '11.02', ceiling: '11.02' });
  });

  it('C1 is unchanged in both orders: a return of the 29.50 line refunds 36.29, a complaint on the 0.6950 × 5 line 4.28', () => {
    const c1 = order([line('a', '29.4950', 1, '0.23'), line('b', '0.6950', 5, '0.23', false)]);
    expect(c1.productsPaidTotal).toBe('40.57');
    const [ret] = defaults(c1, 'return', [{ orderItemId: 'a', quantity: 1 }]);
    const [after] = defaults(c1, 'complaint', [{ orderItemId: 'b', quantity: 5 }], [
      { orderItemId: 'a', quantity: 1, defaultRefundAmount: ret!.refund, defaultDiscountAmount: ret!.discount },
    ]);
    expect([ret!.effective, after!.effective]).toEqual(['36.29', '4.28']);
    const [first] = defaults(c1, 'complaint', [{ orderItemId: 'b', quantity: 5 }]);
    const [then] = defaults(c1, 'return', [{ orderItemId: 'a', quantity: 1 }], [], [{ orderItemId: 'b', amount: first!.effective }]);
    expect([first!.effective, then!.effective]).toEqual(['4.28', '36.29']);
  });

  it('cases settled out of creation order: the second settled first refunds 12.32, the first then 12.31 (#875)', () => {
    // Created as 1 unit then 1 unit: the second was shown 12.31 on the live basis.
    const [shown1] = defaults(bolts, 'return', [{ orderItemId: 'A', quantity: 1 }]);
    const [shown2] = defaults(bolts, 'return', [{ orderItemId: 'A', quantity: 1 }], [
      { orderItemId: 'A', quantity: 1, defaultRefundAmount: shown1!.refund, defaultDiscountAmount: '0.00' },
    ]);
    expect([shown1!.refund, shown2!.refund]).toEqual(['12.32', '12.31']);
    // Settled the other way round, on the settled basis.
    const [settled2] = defaults(bolts, 'return', [{ orderItemId: 'A', quantity: 1 }]);
    const [settled1] = defaults(bolts, 'return', [{ orderItemId: 'A', quantity: 1 }], [
      { orderItemId: 'A', quantity: 1, defaultRefundAmount: settled2!.refund, defaultDiscountAmount: '0.00' },
    ]);
    expect([settled2!.refund, settled1!.refund]).toEqual(['12.32', '12.31']);
    expect(moneyDifference('36.94', decimalSum(settled2!.refund, settled1!.refund))).toBe(
      vatByRate([{ net: '10.01', rate: '0.23' }], 'fraction').gross,
    );
  });
});

/**
 * The settlement as the service runs it, over random orders and random cases:
 * returns and complaints created in turn, then settled in a random order —
 * some rejected, some replaced, some at their default and some reduced by the
 * operator — each one recomputed on the settled basis under the order's lock.
 */
describe('settlement on the settled kept state, with complaints and the line ceiling (property, #874, #875)', () => {
  type Kind = 'return' | 'complaint';
  type KeptLine = { orderItemId: string; quantity: number; defaultRefundAmount: string; defaultDiscountAmount: string };
  for (const [vatMethod, withDiscount] of [
    ['per_rate', false],
    ['per_rate', true],
    [null, false],
    [null, true],
  ] as const) {
    it(`money never exceeds a line's value or what was paid, and the kept state telescopes (${vatMethod ?? 'legacy'}${withDiscount ? ', discounted' : ''})`, () => {
      let bound = 0;
      for (let seed = 1; seed <= 300; seed += 1) {
        const next = rng(seed * 7919 + 17);
        const o = randomOrder(next, vatMethod, withDiscount);
        const input = { ...o, orderLines: o.lines };
        const values = new Map(o.lines.map((l) => [l.orderItemId, lineValue(input, l.orderItemId)]));

        // Create the cases. Both kinds take up returnable quantity; a return names returnable lines only.
        const left = new Map(o.lines.map((l) => [l.orderItemId, l.purchasedQty]));
        const created: Array<{ kind: Kind; lines: Array<{ orderItemId: string; quantity: number }>; shown: string[] }> = [];
        const provisional: KeptLine[] = [];
        for (let k = 0; k < 1 + Math.floor(next() * 5); k += 1) {
          const kind: Kind = next() < 0.35 ? 'complaint' : 'return';
          const lines = o.lines
            .filter((l) => left.get(l.orderItemId)! > 0 && (kind === 'complaint' || l.returnable) && next() < 0.6)
            .map((l) => ({ orderItemId: l.orderItemId, quantity: 1 + Math.floor(next() * left.get(l.orderItemId)!) }));
          if (lines.length === 0) continue;
          for (const l of lines) left.set(l.orderItemId, left.get(l.orderItemId)! - l.quantity);
          const shown = effectiveDefaultRefunds({ ...input, earlier: provisional, complaints: [], kind, current: lines });
          if (kind === 'return') {
            lines.forEach((l, i) => provisional.push({ ...l, defaultRefundAmount: shown[i]!.refund, defaultDiscountAmount: shown[i]!.discount }));
          }
          created.push({ kind, lines, shown: shown.map((s) => s.refund) });
        }

        // Settle them in a random order.
        const order = created.map((_, i) => i).sort(() => next() - 0.5);
        const kept: KeptLine[] = [];
        const complaints: Array<{ orderItemId: string; amount: string }> = [];
        const moneyByLine = new Map<string, string>();
        let money = '0.00';
        for (const index of order) {
          const c = created[index]!;
          const fate = next();
          if (fate < 0.3) continue; // rejected, replaced or repaired: no money, outside the kept state
          const reduced = fate > 0.8;
          const now = effectiveDefaultRefunds({ ...input, earlier: kept, complaints, kind: c.kind, current: c.lines });
          if (complaints.length === 0) {
            // Complaint-free, the defaults are exactly the #875 rule, and a return's
            // ceiling never applies (a complaint line is always bounded by its own).
            const plain = caseDefaultRefunds({ ...input, earlier: kept, current: c.lines });
            expect(now.map((r) => ({ refund: r.refund, discount: r.discount })), `seed ${seed}`).toEqual(plain);
            if (c.kind === 'return') {
              expect(now.every((r) => r.effective === r.refund && r.ceiling === null), `seed ${seed}`).toBe(true);
            }
          }
          c.lines.forEach((l, i) => {
            const r = now[i]!;
            const orderLine = o.lines.find((x) => x.orderItemId === l.orderItemId)!;
            if (compareCents(r.effective, r.refund) < 0) bound += 1;
            const zeroIsAmount = c.kind === 'complaint' && !orderLine.returnable;
            // The operator approves the default the form showed, or types less.
            const requested = reduced
              ? roundHalfUp(Math.floor(next() * (cents(r.effective) + 1)) / 100)
              : zeroIsAmount
                ? r.effective
                : c.shown[i]!;
            const settled = settlementApproved({
              requested,
              previousDefault: c.shown[i]!,
              recomputedDefault: r.refund,
              effectiveDefault: r.effective,
              zeroIsAmount,
            });
            expect('approved' in settled, `seed ${seed}: a default or a lower amount is never refused`).toBe(true);
            const approved = (settled as { approved: string }).approved;
            expect(cents(approved), `seed ${seed}: a negative refund`).toBeGreaterThanOrEqual(0);
            expect(compareCents(approved, r.effective), `seed ${seed}: above the effective default`).toBeLessThanOrEqual(0);
            if (c.kind === 'return') kept.push({ ...l, defaultRefundAmount: r.refund, defaultDiscountAmount: r.discount });
            else complaints.push({ orderItemId: l.orderItemId, amount: approved });
            money = decimalSum(money, approved);
            moneyByLine.set(l.orderItemId, decimalSum(moneyByLine.get(l.orderItemId) ?? '0', approved));
          });

          expect(compareCents(money, o.productsPaidTotal), `seed ${seed}: refunded more than was paid`).toBeLessThanOrEqual(0);
          for (const [id, m] of moneyByLine) {
            // A line never takes back more than it was paid, up to the cent a rate's rounding
            // hands one line of a case rather than another.
            expect(cents(m) - cents(values.get(id)!), `seed ${seed}: line ${id} refunded ${m} of ${values.get(id)}`).toBeLessThanOrEqual(1);
          }
          if (vatMethod === 'per_rate' && complaints.length === 0) {
            // What is left paid on the stored defaults is what an invoice of the kept goods charges.
            const returned = new Map<string, number>();
            for (const k of kept) returned.set(k.orderItemId, (returned.get(k.orderItemId) ?? 0) + k.quantity);
            const keptNets = o.lines.map((l) => ({
              net: lineAmountHalfUp(l.unitNetPrice, l.purchasedQty - (returned.get(l.orderItemId) ?? 0)),
              rate: l.taxRate,
            }));
            const carried = kept.map((k) => carriedDiscount(k.defaultDiscountAmount, k.defaultRefundAmount, k.defaultRefundAmount));
            expect(
              moneyDifference(o.productsPaidTotal, decimalSum('0', ...kept.map((k) => k.defaultRefundAmount))),
              `seed ${seed}: the kept invoice`,
            ).toBe(moneyDifference(vatByRate(keptNets, 'fraction').gross, moneyDifference(o.discountTotal, decimalSum('0', ...carried))));
          }
        }

        const everyUnitReturned = o.lines.every(
          (l) => kept.filter((k) => k.orderItemId === l.orderItemId).reduce((n, k) => n + k.quantity, 0) === l.purchasedQty,
        );
        if (everyUnitReturned && complaints.length === 0) {
          // Every unit came back through returns: their defaults are what was paid, and carry the whole discount.
          expect(decimalSum('0', ...kept.map((k) => k.defaultRefundAmount)), `seed ${seed}: a complete return`).toBe(o.productsPaidTotal);
          expect(decimalSum('0', ...kept.map((k) => k.defaultDiscountAmount)), `seed ${seed}: the discount`).toBe(
            roundHalfUp(o.discountTotal),
          );
        }
      }
      // On orders placed per rate — where a line's refunds can outgrow it — the
      // generator reaches the ceiling, so the bound above is not vacuous.
      if (vatMethod === 'per_rate') expect(bound).toBeGreaterThan(0);
    });
  }
});

function compareCents(a: string, b: string): number {
  return Math.sign(cents(a) - cents(b));
}
