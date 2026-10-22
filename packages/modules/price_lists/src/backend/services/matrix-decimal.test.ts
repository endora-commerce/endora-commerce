import { describe, expect, it } from 'vitest';
import * as contracts from '@endora-commerce/contracts';
import * as matrixDecimal from './matrix-decimal.js';
import { applyDiscountPercent, parsePercentHundredths } from './matrix-decimal.js';

/**
 * Feature 161, G17 — the decimal helpers the admin previews with live in
 * `@endora-commerce/contracts` (`price-book-decimal.ts`, their cases moved to
 * `packages/contracts/test/price-book-decimal.unit.test.ts`); this module
 * re-exports them, so the server prices with the one implementation the
 * browser previews with, not with a copy of it.
 */
describe('one decimal implementation (161 G17)', () => {
  it('re-exports the contracts helpers, not copies of them', () => {
    const shared = [
      'parseUnits',
      'formatUnits',
      'parseSignedUnits',
      'parseSignedPercentHundredths',
      'applySignedPercent',
      'applyAmountAdjustment',
      'normaliseAmount',
      'compareDecimal',
    ] as const;
    for (const name of shared) {
      expect(typeof contracts[name], name).toBe('function');
      expect(matrixDecimal[name], name).toBe(contracts[name]);
    }
  });
});

/**
 * Feature 148 — the discount helpers of the old `discount_percent` matrix
 * price (research R17/R18), which stay in this module: they are not part of
 * the price-book model, so G17 does not publish them.
 */
describe('parsePercentHundredths', () => {
  it('parses a percentage to integer hundredths', () => {
    expect(parsePercentHundredths('12')).toBe(1200n);
    expect(parsePercentHundredths('33.33')).toBe(3333n);
    expect(parsePercentHundredths('12.5')).toBe(1250n);
    expect(parsePercentHundredths('100.00')).toBe(10_000n);
  });

  it('refuses more than two fractional digits', () => {
    expect(() => parsePercentHundredths('1.234')).toThrow();
  });
});

describe('applyDiscountPercent', () => {
  it('takes the percentage off the reference amount', () => {
    expect(applyDiscountPercent('100.0000', '12')).toBe('88.0000');
    expect(applyDiscountPercent('100', '5')).toBe('95.0000');
  });

  it('rounds half-up at the fifth fractional digit', () => {
    // 0.0525 × 66.67% = 0.035001… → 0.0350
    expect(applyDiscountPercent('0.0525', '33.33')).toBe('0.0350');
    // 0.0001 × 50% = 0.00005 → half rounds up → 0.0001
    expect(applyDiscountPercent('0.0001', '50')).toBe('0.0001');
    // 0.0003 × 50% = 0.00015 → 0.0002
    expect(applyDiscountPercent('0.0003', '50')).toBe('0.0002');
    // 9.9999 × 87.5% = 8.7499125 → 8.7499
    expect(applyDiscountPercent('9.9999', '12.5')).toBe('8.7499');
  });

  it('yields zero for a 100% discount', () => {
    expect(applyDiscountPercent('123.4567', '100')).toBe('0.0000');
  });

  it('does not drift on amounts a float cannot hold exactly', () => {
    // 9 999 999 999.9999 × 0.99 — beyond a double's 15 significant digits.
    expect(applyDiscountPercent('9999999999.9999', '1')).toBe('9899999999.9999');
    expect(applyDiscountPercent('1234567890.1234', '0.01')).toBe('1234444433.3344');
  });
});
