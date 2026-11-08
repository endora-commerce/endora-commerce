import { describe, expect, it } from 'vitest';
import { quoteRequestAmountSchema } from '@endora-commerce/contracts';
import { quoteRequestAmount } from './quote-amount.js';

/**
 * Issue #456 (owner ruling of 2026-11-07) — one rule for what a quote request
 * is worth, the one the quote desk, CRM and Projects all show: per line,
 * Σ quantity × (agreed price ?? asked price), and "partially agreed" while not
 * every line has an agreed price.
 */
const line = (quantity: number, agreed: string | null, asked: string | null, currency = 'PLN') => ({
  quantity,
  agreedUnitPrice: agreed,
  desiredUnitPrice: asked,
  lineCurrency: currency,
});

describe('quoteRequestAmount (issue #456)', () => {
  it('values each line at its agreed price, or the asked one while none is agreed', () => {
    expect(quoteRequestAmount([line(2, '10.0000', '12.0000'), line(3, null, '5.0000')])).toEqual({
      amount: '35.00',
      currency: 'PLN',
      partiallyAgreed: true,
    });
  });

  it('is not partially agreed once every line has an agreed price', () => {
    expect(quoteRequestAmount([line(2, '10.0000', '12.0000'), line(1, '4.5000', null)])).toEqual({
      amount: '24.50',
      currency: 'PLN',
      partiallyAgreed: false,
    });
  });

  it('a line with neither price adds nothing and leaves the quote partially agreed', () => {
    expect(quoteRequestAmount([line(4, null, null), line(1, '7.0000', null)])).toEqual({
      amount: '7.00',
      currency: 'PLN',
      partiallyAgreed: true,
    });
    expect(quoteRequestAmount([line(4, null, null)])).toEqual({ amount: '0.00', currency: 'PLN', partiallyAgreed: true });
  });

  it('keeps the four-place unit price and rounds each line value once, half up (pricing.md)', () => {
    expect(quoteRequestAmount([line(10_000, '0.0125', null)]).amount).toBe('125.00');
    // 3 × 0.0150 = 0.045 is a line value of 0.05; two such lines are 0.10, not
    // a rounding of the exact 0.09 — the line value is the rounding point.
    expect(quoteRequestAmount([line(3, '0.0150', null), line(3, null, '0.0150')]).amount).toBe('0.10');
  });

  it('a quote without a line is worth 0.00, in no currency, and is not partially agreed', () => {
    expect(quoteRequestAmount([])).toEqual({ amount: '0.00', currency: null, partiallyAgreed: false });
  });

  it('answers in the published shape', () => {
    const amount = quoteRequestAmount([line(3, '0.3333', null)]);
    expect(quoteRequestAmountSchema.parse(amount)).toEqual(amount);
    expect(amount.amount).toBe('1.00');
  });
});
