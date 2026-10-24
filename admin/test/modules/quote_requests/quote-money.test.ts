import { describe, expect, it } from 'vitest';
import { quoteTotals } from '../../../../packages/modules/quote_requests/src/admin/quote-totals';
import { sectionTotals } from '../../../../packages/modules/quote_requests/src/admin/line-groups';
import { referenceDifference } from '../../../../packages/modules/quote_requests/src/admin/reference-difference';

/**
 * Issue #417 — the quote screens' figures in exact decimal arithmetic, under
 * the quote's rule: VAT on the net total at the quote's one rate, gross = net +
 * VAT (the rule the order it converts into applies). On doubles, 0.70 at 5 %
 * showed a VAT of 0.03.
 */
describe('quoteTotals', () => {
  it('takes the VAT on the exact net total (T1 at 5 %)', () => {
    expect(quoteTotals([{ agreedUnitPrice: 0.7, quantity: 1 }], 0.05)).toEqual({ net: 0.7, tax: 0.04, gross: 0.74 });
  });

  it('sums the lines exactly (V2 at one rate)', () => {
    expect(
      quoteTotals(
        [
          { agreedUnitPrice: 0.1, quantity: 3 },
          { agreedUnitPrice: 29.5, quantity: 1 },
        ],
        0.23,
      ),
    ).toEqual({ net: 29.8, tax: 6.85, gross: 36.65 });
  });

  it('is null unless every line is priced', () => {
    expect(quoteTotals([{ agreedUnitPrice: null, quantity: 1 }], 0.23)).toBeNull();
  });
});

describe('sectionTotals (quote screens)', () => {
  it('takes a section’s VAT half-up on the exact product, not the binary 0.03 (T1)', () => {
    expect(sectionTotals([{ net: 0.7, reference: null }], 0.05)).toMatchObject({ net: 0.7, vat: 0.04, gross: 0.74 });
  });
});

describe('referenceDifference — exact (#417)', () => {
  it('rounds a typed price’s difference half-up on its decimal digits', () => {
    expect(referenceDifference(1.005, 'PLN', { amount: 1, currency: 'PLN' })).toEqual({ amount: 0.01, percent: 0.5 });
  });
});
