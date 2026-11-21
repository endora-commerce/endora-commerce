import type { RelatedPayerOperatorReason, RelatedPayerRequestState } from '@endora-commerce/contracts';

/** The operator queue's two filters (FR-023): the request state, and why a request waits. */
export interface QueueFilters {
  readonly state: RelatedPayerRequestState;
  /** `''` is any reason. */
  readonly reason: RelatedPayerOperatorReason | '';
}

/** What the queue opens on: what waits for an operator, whatever the reason. */
export const DEFAULT_QUEUE_FILTERS: QueueFilters = { state: 'pending', reason: '' };

/**
 * Whether the operator has narrowed the queue away from what it opens on — which offers
 * *Clear all filters*, and makes an empty answer "nothing matches" rather than "nothing waits"
 * (UX audit DS-06 #1440, DS-15 #1448).
 */
export function queueFiltersActive(filters: QueueFilters): boolean {
  return filters.state !== DEFAULT_QUEUE_FILTERS.state || filters.reason !== DEFAULT_QUEUE_FILTERS.reason;
}
