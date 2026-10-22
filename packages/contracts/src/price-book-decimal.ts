/**
 * Integer decimal arithmetic for price-book prices — feature 161, G17
 * (`specs/161-price-book-editor/contracts/backend-gaps.md`), moved here from
 * `price_lists`' `matrix-decimal.ts` (features 148 and 160), which re-exports
 * it: the resolver prices with these functions and the admin's labelled
 * previews (FR-030) compute with the same ones, so a preview rounds exactly as
 * the server does.
 *
 * Amounts are `numeric(14,4)` and percentages two places, and both travel as
 * strings. A percentage or an amount adjustment is the one place a price is
 * *computed* rather than read, so it is computed on integers: amounts in
 * ten-thousandths, percentages in hundredths, one multiplication and one
 * half-up rounding back to four fractional digits — the precision a typed row
 * is stored at, so a computed price and a typed one are indistinguishable to
 * carts and orders. A double carries fifteen significant digits and
 * `numeric(14,4)` eighteen, which is why nothing here goes through `Number`.
 * No dependency: one multiplication does not justify one (Constitution IV).
 */

const AMOUNT = /^(\d+)(?:\.(\d{1,4}))?$/;
const SIGNED_AMOUNT = /^(-)?(\d+)(?:\.(\d{1,4}))?$/;
const SIGNED_PERCENT = /^(-)?(\d{1,4})(?:\.(\d{1,2}))?$/;

/** A non-negative decimal string with up to four fractional digits, as ten-thousandths. */
export function parseUnits(value: string): bigint {
  const match = AMOUNT.exec(value);
  if (!match) throw new Error(`Not a decimal amount with up to 4 fractional digits: "${value}"`);
  return BigInt(match[1]!) * 10_000n + BigInt((match[2] ?? '').padEnd(4, '0'));
}

/** Ten-thousandths as a decimal string with exactly four fractional digits. */
export function formatUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 10_000n;
  const fraction = (abs % 10_000n).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/** Numeric comparison of two non-negative decimal strings: −1, 0 or 1. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const x = parseUnits(a);
  const y = parseUnits(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** A signed decimal string with up to four fractional digits, as ten-thousandths. */
export function parseSignedUnits(value: string): bigint {
  const match = SIGNED_AMOUNT.exec(value);
  if (!match) throw new Error(`Not a signed decimal amount with up to 4 fractional digits: "${value}"`);
  const units = BigInt(match[2]!) * 10_000n + BigInt((match[3] ?? '').padEnd(4, '0'));
  return match[1] ? -units : units;
}

/** A signed percentage with up to two fractional digits, as hundredths of a percent. */
export function parseSignedPercentHundredths(value: string): bigint {
  const match = SIGNED_PERCENT.exec(value);
  if (!match) throw new Error(`Not a signed percentage with up to 2 fractional digits: "${value}"`);
  const hundredths = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -hundredths : hundredths;
}

/**
 * `reference × (1 + percent / 100)`, rounded half-up to four fractional digits
 * (FR-019 of spec 160) — `−10` is a 10 % discount, `+20` a 20 % surcharge. The
 * reference is a price (never negative) and the percentage is at least −100,
 * so the product is never negative and half-up is one integer step. `null`
 * when the result would be negative, which the bounds make impossible but the
 * caller treats as "this row does not price" all the same (FR-008).
 */
export function applySignedPercent(reference: string, percent: string): string | null {
  const units = parseUnits(reference);
  const factor = 10_000n + parseSignedPercentHundredths(percent);
  if (factor < 0n) return null;
  return formatUnits((units * factor + 5_000n) / 10_000n);
}

/** `reference + delta`, or `null` when that is below zero (FR-008). Zero is a price. */
export function applyAmountAdjustment(reference: string, delta: string): string | null {
  const units = parseUnits(reference) + parseSignedUnits(delta);
  return units < 0n ? null : formatUnits(units);
}

/** A non-negative decimal string normalised to four fractional digits. */
export function normaliseAmount(value: string): string {
  return formatUnits(parseUnits(value));
}
