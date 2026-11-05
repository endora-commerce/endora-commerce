const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a record page's `[id]` segment can name a record at all (issue #749).
 *
 * Orders, returns, quote requests, shopping lists and carts are keyed by a
 * `uuid` column. A segment of another shape — the 8-character prefix the
 * storefront prints, a typo — names no record, but the API hands it to
 * PostgreSQL unchecked and answers `500`, not `404`; a page that only reads a
 * `404` as "not found" then crashes the request. Such a page asks this first
 * and renders its own not-found answer without calling the API.
 *
 * Shape only, the backend's own `isUuid` test: no version or variant bits,
 * which PostgreSQL does not check either and seeded ids do not always honour.
 */
export function isRecordId(id: string): boolean {
  return UUID.test(id);
}
