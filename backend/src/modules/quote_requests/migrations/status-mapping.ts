/**
 * Legacy → new status mapping for the Quote Requests workflow rewrite
 * (feature 008). The mapping itself is pure so we can unit-test it
 * without bringing up Postgres. The migration consumes this exact
 * function in its data step.
 *
 * Spec reference: research.md §R1, data-model.md §8.
 */

export type LegacyStatus =
  | 'draft'
  | 'new'
  | 'under_review'
  | 'quoted'
  | 'accepted'
  | 'rejected'
  | 'expired';

export type NewStatus =
  | 'Created from admin'
  | 'Pending'
  | 'Canceled'
  | 'Approved'
  | 'Completed'
  | 'Expired';

export interface MappingResult {
  /** Target status. `null` means the row should be deleted (legacy `draft`). */
  status: NewStatus | null;
  /** Whether to set `awaiting_customer_revision_acceptance = true`. */
  awaitingCustomerRevisionAcceptance: boolean;
}

export function mapLegacyStatus(legacy: LegacyStatus): MappingResult {
  switch (legacy) {
    case 'draft':
      return { status: null, awaitingCustomerRevisionAcceptance: false };
    case 'new':
    case 'under_review':
      return { status: 'Pending', awaitingCustomerRevisionAcceptance: false };
    case 'quoted':
      // Sales rep had issued a counter-quote; under the new model that is
      // the "modified, awaiting customer accept/reject" state.
      return { status: 'Pending', awaitingCustomerRevisionAcceptance: true };
    case 'accepted':
      return { status: 'Approved', awaitingCustomerRevisionAcceptance: false };
    case 'rejected':
      return { status: 'Canceled', awaitingCustomerRevisionAcceptance: false };
    case 'expired':
      return { status: 'Expired', awaitingCustomerRevisionAcceptance: false };
  }
}
