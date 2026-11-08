/**
 * Which cases decide what the buyer keeps of an order (issues #874 and #875).
 *
 * Only goods given back for money leave the kept state: a `return` case settled
 * with a refund or a credit. A replacement and a repair send goods back to the
 * buyer, and a complaint is a price reduction of goods the buyer keeps (issue
 * #885), so neither changes what is kept. This is the predicate
 * `ReturnRefundReadService.listReturnedQuantities` reads, so the default refund,
 * the kept-lines invoice and the corrections all count the same cases.
 *
 * A complaint settled with money is counted apart ({@link refundsOutsideKeptState}):
 * against what is left paid of the order, and against the line it names.
 */

/** The resolutions that move money: a refund, or a credit to the organization's limit. */
export const MONEY_RESOLUTIONS = ['refund', 'credit'] as const;

/** Statuses whose cases are void: they consume no quantity and refund nothing (FR-003). */
export const VOID_STATUS_CODES: ReadonlySet<string> = new Set(['rejected', 'cancelled']);

export interface KeptStateCase {
  kind: 'return' | 'complaint';
  /** Written only by the settlement, so `null` means not settled. */
  resolutionType?: 'refund' | 'credit' | 'replacement' | 'repair' | null;
  statusCode: string;
}

const movesMoney = (c: KeptStateCase): boolean =>
  c.resolutionType === 'refund' || c.resolutionType === 'credit';

/** A settled case whose goods left the kept state: a return settled with a refund or a credit. */
export function entersKeptState(c: KeptStateCase): boolean {
  return c.kind === 'return' && movesMoney(c);
}

/**
 * The provisional basis a new case's default is shown on at creation (issue
 * #875): every live return that is not settled yet, as well as those settled
 * for money. Settled in creation order this is the settled basis, so in the
 * normal flow the figure shown at creation is the one settled.
 */
export function entersKeptStateProvisionally(c: KeptStateCase): boolean {
  if (c.kind !== 'return' || VOID_STATUS_CODES.has(c.statusCode)) return false;
  return c.resolutionType == null || movesMoney(c);
}

/** A complaint settled with money: a price reduction, outside the kept state (issue #874). */
export function refundsOutsideKeptState(c: KeptStateCase): boolean {
  return c.kind === 'complaint' && movesMoney(c);
}
