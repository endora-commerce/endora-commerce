/**
 * Refund math — pure domain (feature 046, US5 / FR-031/032).
 *
 * The default refund for a returned quantity is the amount paid for that
 * quantity in the original order (the per-unit paid amount already includes its
 * proportional tax, resolved by the OrderReturnContextPort). The approved amount
 * an admin settles per line may never exceed that default; the case total is the
 * sum of the approved per-line amounts.
 */

/** Tolerance for floating-point comparison of money amounts (half a cent). */
export const REFUND_EPSILON = 0.005;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Default refund for a returned quantity = paid-per-unit (incl. tax) × quantity. */
export function defaultRefundForQuantity(paidUnitAmount: number, quantity: number): number {
  return round2(paidUnitAmount * quantity);
}

/** True when an approved amount exceeds the line's paid cap (beyond tolerance). */
export function exceedsCap(approved: number, cap: number): boolean {
  return approved > cap + REFUND_EPSILON;
}

/** Case total = sum of the approved per-line amounts, rounded to cents. */
export function sumApproved(amounts: number[]): number {
  return round2(amounts.reduce((acc, n) => acc + n, 0));
}
