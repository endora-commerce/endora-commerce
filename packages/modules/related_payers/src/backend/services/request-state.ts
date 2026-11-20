import { ERROR_CODES, type RelatedPayerRequestState } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/** `specs/182-related-payers/` FR-045 — every state but `pending` is final. */
export function isTerminalRequestState(state: RelatedPayerRequestState): boolean {
  return state !== 'pending';
}

/**
 * FR-045 — a decision moves a `pending` request to one terminal state, once. A request already
 * decided, or one whose version moved since the caller read it (the loser of two concurrent
 * decisions), is refused `409 RELATED_PAYER_REQUEST_DECIDED`.
 */
export function assertRequestDecision(
  request: { readonly state: RelatedPayerRequestState; readonly version: number },
  to: Exclude<RelatedPayerRequestState, 'pending'>,
  expectedVersion: number,
): void {
  if ((to as RelatedPayerRequestState) === 'pending') {
    throw new Error('[related_payers] `pending` is not a decision.');
  }
  if (isTerminalRequestState(request.state) || request.version !== expectedVersion) {
    throw new HttpError(409, ERROR_CODES.RELATED_PAYER_REQUEST_DECIDED, 'This request has already been decided.');
  }
}
