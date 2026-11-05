import { isUuidShape } from '@endora-commerce/contracts';

/**
 * Whether a record page's `[id]` segment can name a record at all (issue #749).
 *
 * Orders, returns, quote requests, shopping lists and carts are keyed by a
 * `uuid` column. A segment of another shape — the 8-character prefix the
 * storefront prints, a typo — names no record. The API answers it `404` since
 * issue #753; a page still asks this first and renders its own not-found
 * answer without spending a call on it.
 *
 * Shape only, the backend's own `isUuidShape` test: no version or variant
 * bits, which PostgreSQL does not check either and seeded ids do not always
 * honour.
 */
export function isRecordId(id: string): boolean {
  return isUuidShape(id);
}
