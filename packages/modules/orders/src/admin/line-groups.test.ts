import { describe, expect, it } from 'vitest';
import { orderSectionTotals } from './line-groups.js';

/**
 * Issue #417 — a section summary on the admin order screens, in exact decimal
 * arithmetic under the order's own rule (`specs/pricing/worked-examples.md`
 * §10.17): a placed order's VAT is the stored line grosses minus the nets; the
 * create screen's VAT is the one VAT method — per rate, on the sum of the nets.
 */
describe('orderSectionTotals', () => {
  it('rounds the create screen VAT half-up on the exact sum, not the binary 0.03 (T1)', () => {
    // `Math.round(0.7 * 0.05 * 100) / 100` is 0.03; the exact tax is 0.035.
    expect(orderSectionTotals([{ net: 0.7, taxRate: 0.05 }])).toEqual({ count: 1, net: 0.7, vat: 0.04, gross: 0.74 });
  });

  it('takes VAT per rate on the sum of the nets (V2, owner ruling of 2026-10-24)', () => {
    expect(
      orderSectionTotals([
        { net: 29.5, taxRate: 0.23 },
        { net: 4.3, taxRate: 0.05 },
      ]),
    ).toEqual({ count: 2, net: 33.8, vat: 7.01, gross: 40.81 });
    const line = { net: 0.02, taxRate: 0.23 };
    expect(orderSectionTotals([line, line, line])).toEqual({ count: 3, net: 0.06, vat: 0.01, gross: 0.07 });
  });

  it('takes a placed order’s gross from its stored line totals', () => {
    expect(
      orderSectionTotals([
        { net: 29.5, taxRate: 0.23, gross: 36.29 },
        { net: 4.3, taxRate: 0.05, gross: 4.52 },
      ]),
    ).toEqual({ count: 2, net: 33.8, vat: 7.01, gross: 40.81 });
  });

  it('is null unless every line is priced', () => {
    expect(orderSectionTotals([{ net: null, taxRate: 0.23 }])).toEqual({ count: 1, net: null, vat: null, gross: null });
  });
});
