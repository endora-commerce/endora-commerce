import { describe, expect, it } from 'vitest';
import { orderSectionTotals, quoteSectionTotals } from '../../components/line-groups/GroupedLineRows';
import { grossFromNet } from '../../lib/i18n/money';

/**
 * Issue #417 — the storefront's quote and order summaries in exact decimal
 * arithmetic, under their rules: a quote's VAT on its net total at the quote's
 * one rate; an order's gross the sum of its stored line grosses and its VAT
 * the difference. On doubles, 0.70 at 5 % showed a VAT of 0.03.
 */
describe('quoteSectionTotals', () => {
  it('takes the VAT half-up on the exact net total, not the binary 0.03 (T1)', () => {
    expect(quoteSectionTotals([{ quantity: 1, agreedUnitPrice: 0.7, desiredUnitPrice: null }], 0.05)).toEqual({
      count: 1,
      net: 0.7,
      vat: 0.04,
      gross: 0.74,
    });
  });

  it('falls back to the desired prices on every line', () => {
    expect(
      quoteSectionTotals(
        [
          { quantity: 3, agreedUnitPrice: null, desiredUnitPrice: 0.1 },
          { quantity: 1, agreedUnitPrice: null, desiredUnitPrice: 29.5 },
        ],
        0.23,
      ),
    ).toEqual({ count: 2, net: 29.8, vat: 6.85, gross: 36.65 });
  });
});

describe('orderSectionTotals', () => {
  it('sums the stored line grosses exactly', () => {
    expect(
      orderSectionTotals([
        { quantity: 1, unitPrice: 29.5, lineTotal: 36.29 },
        { quantity: 1, unitPrice: 4.3, lineTotal: 4.52 },
      ]),
    ).toEqual({ count: 2, net: 33.8, vat: 7.01, gross: 40.81 });
  });
});

describe('grossFromNet — a negative net (#417)', () => {
  it('rounds half away from zero on the exact product, not the binary double', () => {
    // `-29.5 * 1.23` is the double -36.28499…
    expect(grossFromNet(-29.5, 0.23)).toBe(-36.29);
  });
});
