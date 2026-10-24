import { compareDecimals, moneyDifference, roundHalfUp } from '@endora-commerce/contracts';

/**
 * The credit arithmetic a reservation decides on, in the contracts' exact
 * decimal arithmetic (issue #417). On doubles, a 0.30 limit with 0.10 reserved
 * had 0.19999999999999998 available and refused a 0.20 order.
 */

/** `granted − reserved`, at two places. */
export function availableCredit(granted: string | number, reserved: string | number): string {
  return moneyDifference(granted, reserved);
}

/** Whether the available credit covers an amount. */
export function coversAmount(available: string | number, amount: string | number): boolean {
  return compareDecimals(available, amount) >= 0;
}

/** An amount as the `numeric(…, 2)` columns store it, half-up on its decimal digits. */
export function creditAmount(value: string | number): string {
  return roundHalfUp(value);
}
