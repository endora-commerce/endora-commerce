import { describe, expect, it } from 'vitest';
import { decimalSum, grossFromNetHalfUp, lineAmountHalfUp, moneyDifference, roundHalfUp, taxAmountExact, vatByRate } from '@endora-commerce/contracts';
import { caseDefaultRefunds, type RefundOrderLine } from './refund-math.js';

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

function randomOrder(next: () => number, vatMethod: 'per_rate' | null, withDiscount = false): Order {
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
  // An order-level discount of up to half the products, taken off the gross.
  const discountTotal = withDiscount ? roundHalfUp(Math.floor(next() * cents(productsPaidTotal) * 0.5) / 100) : '0.00';
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
      const keptInvoice = moneyDifference(
        vatByRate(keptNets, 'fraction').gross,
        moneyDifference(order.discountTotal, decimalSum('0', ...discounts)),
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
  for (const [vatMethod, withDiscount] of [
    ['per_rate', false],
    [null, false],
    ['per_rate', true],
    [null, true],
  ] as const) {
    it(`never refunds more than was paid, and a complete return refunds it exactly (${vatMethod ?? 'legacy'}${withDiscount ? ', discounted' : ''}, returns and complaints)`, () => {
      for (let seed = 1; seed <= 300; seed += 1) {
        const next = rng(seed);
        const order = randomOrder(next, vatMethod, withDiscount);
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
