import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/** The gap between two neighbours' weights after a batch reorder, so a later insert fits between them. */
export const REORDER_WEIGHT_STEP = 10;

/**
 * The one check a batch reorder makes before it moves anything (issue #1560,
 * the architect's ruling): `ordered` must name every `current` code exactly
 * once. A code that is not configured is the caller's `notFound` (404); a code
 * left out or named twice means the list changed under the caller, which is
 * 409 `ORDER_STALE` — the client reloads.
 */
export function assertCompleteOrder(
  current: readonly string[],
  ordered: readonly string[],
  notFound: (code: string) => HttpError,
): void {
  const known = new Set(current);
  const unknown = ordered.find((code) => !known.has(code));
  if (unknown !== undefined) throw notFound(unknown);
  const named = new Set(ordered);
  if (named.size !== ordered.length || named.size !== known.size) {
    throw new HttpError(
      409,
      ERROR_CODES.ORDER_STALE,
      'The list changed since it was loaded: reload it and order it again.',
      { expected: known.size, received: ordered.length },
    );
  }
}
