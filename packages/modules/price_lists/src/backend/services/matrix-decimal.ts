/**
 * Integer decimal arithmetic for matrix prices (feature 148, research R17/R18).
 *
 * The price-book helpers — `parseUnits`, `formatUnits`, `parseSignedUnits`,
 * `parseSignedPercentHundredths`, `applySignedPercent`, `applyAmountAdjustment`,
 * `normaliseAmount` and `compareDecimal` — live in `@endora-commerce/contracts`
 * (`price-book-decimal.ts`, feature 161 G17) so the admin's previews round
 * exactly as the resolver does; they are re-exported here so the resolver's
 * imports stay as they were and the server keeps **one** implementation. What
 * remains below is built on them and is used by this module alone: the
 * normalisation of stored signed values, the duplicate's multiplier, and the
 * old `discount_percent` helpers of feature 148.
 */
import {
  applyAmountAdjustment,
  applySignedPercent,
  compareDecimal,
  formatUnits,
  normaliseAmount,
  parseSignedPercentHundredths,
  parseSignedUnits,
  parseUnits,
} from '@endora-commerce/contracts';

export {
  applyAmountAdjustment,
  applySignedPercent,
  compareDecimal,
  formatUnits,
  normaliseAmount,
  parseSignedPercentHundredths,
  parseSignedUnits,
  parseUnits,
};

const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/** A percentage with up to two fractional digits, as hundredths of a percent. */
export function parsePercentHundredths(value: string): bigint {
  const match = PERCENT.exec(value);
  if (!match) throw new Error(`Not a percentage with up to 2 fractional digits: "${value}"`);
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

/**
 * `reference × (100 − percent) / 100`, rounded half-up to four fractional
 * digits. With the reference in ten-thousandths and the percentage in
 * hundredths the product is exact and the divisor is 10 000, so the rounding is
 * one integer step: add half the divisor, then truncate.
 */
export function applyDiscountPercent(reference: string, percent: string): string {
  const units = parseUnits(reference);
  const keep = 10_000n - parsePercentHundredths(percent);
  if (keep < 0n) throw new Error(`A discount above 100% is not a price: "${percent}"`);
  return formatUnits((units * keep + 5_000n) / 10_000n);
}

/** A signed decimal string normalised to four fractional digits. */
export function normaliseSignedAmount(value: string): string {
  return formatUnits(parseSignedUnits(value));
}

/** A signed percentage normalised to two fractional digits (the column's scale). */
export function normaliseSignedPercent(value: string): string {
  const hundredths = parseSignedPercentHundredths(value);
  const negative = hundredths < 0n;
  const abs = negative ? -hundredths : hundredths;
  return `${negative ? '-' : ''}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, '0')}`;
}

const MULTIPLIER = /^(\d{1,6})(?:\.(\d{1,6}))?$/;

/**
 * `value × multiplier`, rounded half-up (half away from zero) to four
 * fractional digits — a duplicated book's fixed and amount rows (FR-036). The
 * multiplier carries up to six fractional digits, so the product is exact in
 * millionths of a ten-thousandth before the one rounding step.
 */
export function multiplySignedAmount(value: string, multiplier: string): string {
  const match = MULTIPLIER.exec(multiplier);
  if (!match) throw new Error(`Not a multiplier with up to 6 fractional digits: "${multiplier}"`);
  const factor = BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'));
  const units = parseSignedUnits(value);
  const negative = units < 0n;
  const product = (negative ? -units : units) * factor;
  const rounded = (product + 500_000n) / 1_000_000n;
  return formatUnits(negative && rounded !== 0n ? -rounded : rounded);
}
