import { describe, expect, it } from 'vitest';
import { decimalSum, grossFromNetHalfUp, lineAmountHalfUp, roundHalfUp, taxAmountExact, vatByRate } from '@endora-commerce/contracts';
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
  lines: RefundOrderLine[];
}

function randomOrder(next: () => number, vatMethod: 'per_rate' | null): Order {
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
      returnable: true,
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
  return { vatMethod, productsPaidTotal, lines };
}

/** Return everything in random partial cases; answer every case's refunds. */
function returnAll(order: Order, next: () => number): string[][] {
  const remaining = new Map(order.lines.map((l) => [l.orderItemId, l.purchasedQty]));
  const earlier: Array<{ orderItemId: string; quantity: number; defaultRefundAmount: string }> = [];
  const cases: string[][] = [];
  while ([...remaining.values()].some((q) => q > 0)) {
    const current = order.lines
      .filter((l) => remaining.get(l.orderItemId)! > 0 && next() < 0.6)
      .map((l) => ({ orderItemId: l.orderItemId, quantity: 1 + Math.floor(next() * remaining.get(l.orderItemId)!) }));
    if (current.length === 0) continue;
    const refunds = caseDefaultRefunds({ ...order, orderLines: order.lines, earlier, current });
    current.forEach((c, i) => {
      remaining.set(c.orderItemId, remaining.get(c.orderItemId)! - c.quantity);
      earlier.push({ ...c, defaultRefundAmount: refunds[i]! });
    });
    cases.push(refunds);
  }
  return cases;
}

describe('caseDefaultRefunds — the reviewer’s cases', () => {
  const order = (unitNetPrice: string, purchasedQty: number, taxRate: string): Order => {
    const net = lineAmountHalfUp(unitNetPrice, purchasedQty);
    return {
      vatMethod: 'per_rate',
      productsPaidTotal: vatByRate([{ net, rate: taxRate }], 'fraction').gross,
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

  it('two returns of 1 × 1.07 at 23 % refund 1.32 + 1.31 = 2.63, what was paid — not 2.64', () => {
    const o = order('1.07', 2, '0.23');
    expect(o.productsPaidTotal).toBe('2.63');
    const first = caseDefaultRefunds({ ...o, orderLines: o.lines, earlier: [], current: [{ orderItemId: 'a', quantity: 1 }] });
    const second = caseDefaultRefunds({
      ...o,
      orderLines: o.lines,
      earlier: [{ orderItemId: 'a', quantity: 1, defaultRefundAmount: first[0]! }],
      current: [{ orderItemId: 'a', quantity: 1 }],
    });
    expect([first[0], second[0]]).toEqual(['1.32', '1.31']);
  });

  it('two returns of 1 × 0.03 at 23 % refund 0.04 + 0.03 = 0.07, not 0.04 twice', () => {
    const o = order('0.03', 2, '0.23');
    expect(o.productsPaidTotal).toBe('0.07');
    const first = caseDefaultRefunds({ ...o, orderLines: o.lines, earlier: [], current: [{ orderItemId: 'a', quantity: 1 }] });
    const second = caseDefaultRefunds({
      ...o,
      orderLines: o.lines,
      earlier: [{ orderItemId: 'a', quantity: 1, defaultRefundAmount: first[0]! }],
      current: [{ orderItemId: 'a', quantity: 1 }],
    });
    expect(cents(first[0]!) + cents(second[0]!)).toBe(7);
  });

  it('keeps a non-returnable complaint line out of the returnable lines’ refunds', () => {
    const o = order('1.07', 2, '0.23');
    const lines: RefundOrderLine[] = [
      ...o.lines,
      { orderItemId: 'b', unitNetPrice: '0.99', taxRate: '0.23', purchasedQty: 1, paidLineAmount: '1.22', returnable: false },
    ];
    const refunds = caseDefaultRefunds({
      ...o,
      orderLines: lines,
      earlier: [],
      current: [
        { orderItemId: 'a', quantity: 1 },
        { orderItemId: 'b', quantity: 1 },
      ],
    });
    // `a` alone: 1.07 + 0.25 = 1.32; `b` is the cap an operator may approve up to, on its own.
    expect(refunds).toEqual(['1.32', '1.22']);
  });
});

describe('caseDefaultRefunds — any sequence of partial returns (property)', () => {
  for (const vatMethod of ['per_rate', null] as const) {
    it(`never refunds more than was paid, and a complete return refunds it exactly (${vatMethod ?? 'legacy'})`, () => {
      for (let seed = 1; seed <= 400; seed += 1) {
        const next = rng(seed);
        const order = randomOrder(next, vatMethod);
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
      }
    });
  }
});
