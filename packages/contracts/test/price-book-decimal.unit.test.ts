import { describe, expect, it } from 'vitest';
import {
  applyAmountAdjustment,
  applySignedPercent,
  compareDecimal,
  formatUnits,
  normaliseAmount,
  parseSignedPercentHundredths,
  parseSignedUnits,
  parseUnits,
} from '../src/index.js';

/**
 * Feature 161, G17 (`specs/161-price-book-editor/contracts/backend-gaps.md`) —
 * the integer decimal arithmetic the server prices with, in the contracts so
 * the admin's labelled previews (FR-030) round exactly as the resolver does.
 *
 * Amounts are `numeric(14,4)` and percentages two places; both are carried as
 * integers so a computed price is exact to the four digits a typed row is
 * stored at and never drifts through a float. The `parseUnits` / `formatUnits`
 * and `compareDecimal` cases moved here from `price_lists`'
 * `matrix-decimal.test.ts` with the functions (feature 148); the signed cases
 * state feature 160's percentages and adjustments (FR-019, FR-008).
 */
describe('parseUnits / formatUnits', () => {
  it('parses a decimal string to integer ten-thousandths', () => {
    expect(parseUnits('100')).toBe(1_000_000n);
    expect(parseUnits('100.0000')).toBe(1_000_000n);
    expect(parseUnits('0.0525')).toBe(525n);
    expect(parseUnits('12.5')).toBe(125_000n);
    expect(parseUnits('0')).toBe(0n);
  });

  it('refuses what is not a non-negative decimal with up to four fractional digits', () => {
    expect(() => parseUnits('1.00001')).toThrow();
    expect(() => parseUnits('-1')).toThrow();
    expect(() => parseUnits('abc')).toThrow();
    expect(() => parseUnits('')).toThrow();
  });

  it('formats ten-thousandths with exactly four fractional digits', () => {
    expect(formatUnits(880_000n)).toBe('88.0000');
    expect(formatUnits(350n)).toBe('0.0350');
    expect(formatUnits(0n)).toBe('0.0000');
    expect(formatUnits(-12_345n)).toBe('-1.2345');
  });
});

describe('compareDecimal', () => {
  it('orders decimal strings numerically regardless of scale', () => {
    expect(compareDecimal('88', '88.0000')).toBe(0);
    expect(compareDecimal('9.5', '10')).toBe(-1);
    expect(compareDecimal('100.0001', '100')).toBe(1);
  });
});

describe('parseSignedUnits / parseSignedPercentHundredths', () => {
  it('parses signed amounts to ten-thousandths', () => {
    expect(parseSignedUnits('-2.5')).toBe(-25_000n);
    expect(parseSignedUnits('10')).toBe(100_000n);
    expect(parseSignedUnits('-0.0001')).toBe(-1n);
    expect(() => parseSignedUnits('1.00001')).toThrow();
    expect(() => parseSignedUnits('+1')).toThrow();
  });

  it('parses signed percentages to hundredths', () => {
    expect(parseSignedPercentHundredths('-10')).toBe(-1000n);
    expect(parseSignedPercentHundredths('12.5')).toBe(1250n);
    expect(parseSignedPercentHundredths('1000')).toBe(100_000n);
    expect(() => parseSignedPercentHundredths('1.234')).toThrow();
  });
});

describe('applySignedPercent', () => {
  it('applies a discount and a surcharge off the reference (worked examples E2, E3, U2.1)', () => {
    expect(applySignedPercent('100.0000', '-10')).toBe('90.0000');
    expect(applySignedPercent('100', '-5')).toBe('95.0000');
    expect(applySignedPercent('50.0000', '-15')).toBe('42.5000');
    expect(applySignedPercent('100', '10')).toBe('110.0000');
    expect(applySignedPercent('120', '-20')).toBe('96.0000');
  });

  it('rounds half-up at the fifth fractional digit', () => {
    // 0.0001 × 0.5 = 0.00005 → 0.0001
    expect(applySignedPercent('0.0001', '-50')).toBe('0.0001');
    // 0.0003 × 0.5 = 0.00015 → 0.0002
    expect(applySignedPercent('0.0003', '-50')).toBe('0.0002');
    // 9.9999 × 0.875 = 8.7499125 → 8.7499
    expect(applySignedPercent('9.9999', '-12.5')).toBe('8.7499');
    // 19.99 × 0.95 = 18.9905 exactly
    expect(applySignedPercent('19.99', '-5')).toBe('18.9905');
  });

  it('yields zero at −100 % and an elevenfold price at +1000 %', () => {
    expect(applySignedPercent('123.4567', '-100')).toBe('0.0000');
    expect(applySignedPercent('2', '1000')).toBe('22.0000');
  });

  it('does not drift on amounts a float cannot hold exactly', () => {
    expect(applySignedPercent('9999999999.9999', '-1')).toBe('9899999999.9999');
    expect(applySignedPercent('1234567890.1234', '-0.01')).toBe('1234444433.3344');
  });
});

describe('applyAmountAdjustment', () => {
  it('adds a signed amount; zero is a price, below zero is none', () => {
    expect(applyAmountAdjustment('80', '-5.5')).toBe('74.5000');
    expect(applyAmountAdjustment('80', '2')).toBe('82.0000');
    expect(applyAmountAdjustment('5', '-5')).toBe('0.0000');
    expect(applyAmountAdjustment('5', '-5.0001')).toBeNull();
  });
});

describe('normaliseAmount', () => {
  it('normalises to four fractional digits', () => {
    expect(normaliseAmount('12.5')).toBe('12.5000');
    expect(normaliseAmount('0')).toBe('0.0000');
    expect(() => normaliseAmount('-1')).toThrow();
  });
});
