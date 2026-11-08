import { periodEndAfter } from './withdrawal-period.js';

/**
 * Free-return window — pure domain (feature 046, US7 / FR-026/027).
 *
 * The window is counted from the moment the order entered its fulfilment-
 * completing status. A `Return`-kind case qualifies as free when it is opened on
 * or before the last day of the window. `days = 0` means there is no free-return
 * option. The boundary is inclusive.
 *
 * Issue #905 (design D3.4): days are calendar days in `returns.time_zone`, the
 * window ending at the end of its last day there, and a last day on a Saturday
 * or Sunday moves to the Monday — the counting of the statutory withdrawal
 * period (`withdrawal-period.ts`). It used to be `anchor + days × 24 h`, which
 * closed up to a day earlier.
 */
export function isWithinFreeWindow(now: Date, completingAt: Date | null, days: number, timeZone: string): boolean {
  if (completingAt === null) return false;
  if (!Number.isFinite(days) || days <= 0) return false;
  return now.getTime() <= periodEndAfter(completingAt, days, timeZone).getTime();
}
