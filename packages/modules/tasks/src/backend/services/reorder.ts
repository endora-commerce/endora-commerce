import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/** The gap between two neighbours' weights after a batch reorder, so a later insert fits between them. */
export const REORDER_WEIGHT_STEP = 10;

/**
 * The one check a batch reorder makes before it moves anything (issue #1560,
 * the architect's rulings): `ordered` must be exactly the `current` codes,
 * each named once. Anything else — a code that is not configured, a code left
 * out, a code named twice — means the list changed under the caller (another
 * administrator added, removed or renamed a row), so it is 409 `ORDER_STALE`
 * and the client reloads. 404 is kept for a missing route or resource.
 */
export function assertCompleteOrder(current: readonly string[], ordered: readonly string[]): void {
  const known = new Set(current);
  const named = new Set(ordered);
  const exact =
    named.size === ordered.length && named.size === known.size && ordered.every((code) => known.has(code));
  if (!exact) {
    throw new HttpError(
      409,
      ERROR_CODES.ORDER_STALE,
      'The list changed since it was loaded: reload it and order it again.',
      { expected: known.size, received: ordered.length },
    );
  }
}
