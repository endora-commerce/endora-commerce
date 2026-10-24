import { describe, expect, it } from 'vitest';
import { orderTotalsMoney } from './order-money.js';

/**
 * Issue #417 — an order's amounts in exact decimal arithmetic, under the one
 * VAT method (owner ruling of 2026-10-24, `vatByRate`): per rate, VAT on the
 * sum of the nets at that rate, rounded half-up once; the total is the
 * products' net + VAT + delivery + surcharge − discount. A line's stored gross
 * (`lineTotal`) is its own rounding, `round(net × (1 + rate))`, informational
 * (owner ruling of 2026-10-24). `specs/pricing/worked-examples.md` §10.17.
 */
const totals = (lines: Array<{ unitPrice: string; quantity: number; taxRate: string | number }>, extra = {}) =>
  orderTotalsMoney({ lines, deliveryTotal: 0, paymentSurcharge: 0, discountTotal: 0, ...extra });

describe('orderTotalsMoney', () => {
  it('rounds a lone line’s gross half-up on the exact product (G1, T1)', () => {
    expect(totals([{ unitPrice: '29.50', quantity: 1, taxRate: 0.23 }]).lines).toEqual([
      { net: '29.50', gross: '36.29', taxRate: '0.2300' },
    ]);
    const t1 = totals([{ unitPrice: '0.70', quantity: 1, taxRate: 0.05 }]);
    expect([t1.taxTotal, t1.total, t1.lines[0]!.gross]).toEqual(['0.04', '0.74', '0.74']);
  });

  it('takes VAT per rate on the sum of the nets (V2: 7.01, total 40.81 — what the invoice says)', () => {
    const t = totals(
      [
        { unitPrice: '29.50', quantity: 1, taxRate: 0.23 },
        { unitPrice: '4.30', quantity: 1, taxRate: 0.05 },
      ],
      { deliveryTotal: '15.00', paymentSurcharge: 2.5, discountTotal: '1.10' },
    );
    expect(t).toMatchObject({
      subtotal: '33.80',
      taxTotal: '7.01',
      deliveryTotal: '15.00',
      paymentSurcharge: '2.50',
      discountTotal: '1.10',
      total: '57.21',
    });
    expect(t.lines.map((l) => l.gross)).toEqual(['36.29', '4.52']);
  });

  it('rounds once per rate: three 0.02 lines at 23 % carry 0.01 VAT', () => {
    const line = { unitPrice: '0.02', quantity: 1, taxRate: '0.23' };
    const t = totals([line, line, line]);
    expect([t.subtotal, t.taxTotal, t.total]).toEqual(['0.06', '0.01', '0.07']);
    // Each line shows its own 0.0246 → 0.02; the lines sum to 0.06 beside a 0.07 total.
    expect(t.lines.map((l) => l.gross)).toEqual(['0.02', '0.02', '0.02']);
  });

  it('shows 29.50 at 23 % as 36.29 beside another 23 % line (owner ruling)', () => {
    const t = totals([
      { unitPrice: '29.50', quantity: 1, taxRate: '0.23' },
      { unitPrice: '16.50', quantity: 1, taxRate: '0.23' },
    ]);
    expect([t.taxTotal, t.total]).toEqual(['10.58', '56.58']);
    expect(t.lines.map((l) => l.gross)).toEqual(['36.29', '20.30']);
  });

  it('adds many amounts without a binary residue', () => {
    const t = totals(
      Array.from({ length: 3 }, () => ({ unitPrice: '0.10', quantity: 1, taxRate: 0 })),
      { deliveryTotal: '0.20', discountTotal: '0.30' },
    );
    expect([t.subtotal, t.total]).toEqual(['0.30', '0.20']);
  });
});
