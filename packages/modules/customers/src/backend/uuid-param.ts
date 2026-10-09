const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a path parameter has the shape of a `uuid` column value.
 *
 * A route that hands an unchecked parameter to PostgreSQL gets
 * `invalid input syntax for type uuid` back, which surfaces as a 500. A value
 * that is not a UUID names no row, so the caller answers the route's own
 * not-found instead. The test is on shape only — deliberately looser than
 * RFC 9562's version and variant bits, which PostgreSQL does not check either
 * and which hand-written seed ids do not always honour.
 */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
