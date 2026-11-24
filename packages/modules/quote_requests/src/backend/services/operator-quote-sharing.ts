/**
 * Sharing an operator's quote with its customer —
 * `specs/192-quote-request-draft-share/` (research R-2, R-8 – R-10).
 *
 * The rules the create, the edit and the share Command apply to an operator's
 * quote while it is unshared, in one place.
 */

/**
 * The validity days an unshared quote carries, from what the operator sent
 * (research R-10, FR-032): `0` and `null` both mean no deadline, stored as
 * `null`; a positive number is kept.
 *
 * **The one place that decides it.** On a quote already shared, `0` keeps its
 * older meaning ("expires now") and `null` is refused — `modify` tells the two
 * apart by `sharedWithCustomer` before it calls this. Should `0` come to mean
 * "no deadline" on a shared quote too, that branch changes, not this.
 */
export function normaliseShareValidityDays(days: number | null): number | null {
  return days === null || days === 0 ? null : days;
}
