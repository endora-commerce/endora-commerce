/**
 * Free-return window — pure domain (feature 046, US7 / FR-026/027).
 *
 * The window is counted from the moment the order entered its fulfilment-
 * completing status. A `Return`-kind case qualifies as free when it is opened on
 * or before the last day of the window. `days = 0` means there is no free-return
 * option. The boundary is inclusive: a case opened exactly `days` days after the
 * anchor still qualifies; one opened a moment later does not.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isWithinFreeWindow(now: Date, completingAt: Date | null, days: number): boolean {
  if (completingAt === null) return false;
  if (!Number.isFinite(days) || days <= 0) return false;
  const deadline = completingAt.getTime() + days * MS_PER_DAY;
  return now.getTime() <= deadline;
}
