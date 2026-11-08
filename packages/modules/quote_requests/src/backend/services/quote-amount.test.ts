import { describe, expect, it } from 'vitest';
import { quoteRequestAmountSchema } from '@endora-commerce/contracts';
import { quoteRequestAmount } from './quote-amount.js';

/**
 * Issue #456 (owner ruling of 2026-11-07) — one rule for what a quote request
 * is worth, the one the quote desk, CRM and Projects all show: per line,
 * Σ quantity × (agreed price ?? asked price). How far the quote is agreed is
 * `agreed`, `partial` or `none`, and a quote without any price has no amount
 * (PO ruling of 2026-11-08: "no price" is not zero).
 */
const line = (quantity: number, agreed: string | null, asked: string | null, currency = 'PLN') => ({
  quantity,
  agreedUnitPrice: agreed,
  desiredUnitPrice: asked,
  lineCurrency: currency,
});

describe('quoteRequestAmount (issue #456)', () => {
  it('every line agreed: the amount at the agreed prices, agreed', () => {
    expect(quoteRequestAmount([line(2, '10.0000', '12.0000'), line(1, '4.5000', null)])).toEqual({
      amount: '24.50',
      currency: 'PLN',
      agreement: 'agreed',
    });
  });

  it('some lines agreed: each line at its agreed price or else the asked one, partial', () => {
    expect(quoteRequestAmount([line(2, '10.0000', '12.0000'), line(3, null, '5.0000')])).toEqual({
      amount: '35.00',
      currency: 'PLN',
      agreement: 'partial',
    });
  });

  it('no line agreed, some asked: the amount at the asked prices, none', () => {
    expect(quoteRequestAmount([line(2, null, '12.0000'), line(3, null, '5.0000')])).toEqual({
      amount: '39.00',
      currency: 'PLN',
      agreement: 'none',
    });
  });

  it('a line with neither price adds nothing; it is not agreed', () => {
    expect(quoteRequestAmount([line(4, null, null), line(1, '7.0000', null)])).toEqual({
      amount: '7.00',
      currency: 'PLN',
      agreement: 'partial',
    });
    expect(quoteRequestAmount([line(4, null, null), line(1, null, '7.0000')]).agreement).toBe('none');
  });

  it('no line with any price: no amount, not 0.00', () => {
    expect(quoteRequestAmount([line(4, null, null), line(1, null, null)])).toEqual({
      amount: null,
      currency: 'PLN',
      agreement: 'none',
    });
  });

  it('a quote without a line: no amount, no currency', () => {
    expect(quoteRequestAmount([])).toEqual({ amount: null, currency: null, agreement: 'none' });
  });

  it('keeps the four-place unit price and rounds each line value once, half up (pricing.md)', () => {
    expect(quoteRequestAmount([line(10_000, '0.0125', null)]).amount).toBe('125.00');
    // 3 × 0.0150 = 0.045 is a line value of 0.05; two such lines are 0.10, not
    // a rounding of the exact 0.09 — the line value is the rounding point.
    expect(quoteRequestAmount([line(3, '0.0150', null), line(3, null, '0.0150')]).amount).toBe('0.10');
  });

  it('answers in the published shape', () => {
    for (const lines of [[line(3, '0.3333', null)], [line(1, null, null)], []]) {
      const amount = quoteRequestAmount(lines);
      expect(quoteRequestAmountSchema.parse(amount)).toEqual(amount);
    }
  });
});
