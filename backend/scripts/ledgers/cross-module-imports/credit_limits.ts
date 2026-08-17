/**
 * Cross-module reaches still standing in `credit_limits` (feature 075, FR-022…FR-026;
 * feature 077, D-87).
 *
 * Keyed `<path under src/>:<target module>/<target path>` for an import and
 * `<path under src/>:sql:<owner>/<table>` for a raw SQL statement, so moving code inside a
 * file does not invalidate an entry and re-opening a hole does not silently inherit one.
 *
 * Two-way: an unledgered reach fails the build, and an entry that no longer describes one
 * fails it too. Delete this file when the last entry goes; an empty shard is refused,
 * because a done signal that says nothing is not one.
 *
 * The one `sql:` entry below was seeded by D-87, on the day the second predicate landed.
 * It is not a new coupling — it is a coupling the check could not see, because raw SQL
 * names no import specifier. It says which port retires it.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/credit_limits/services/credit-limit-service.ts:sql:orders/orders':
    'D-87 seed — `credit_limits` reads `orders`\'s `orders` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `orderReadPort`, resolved through `lazyPort` with `orders` ' +
    'declared in this module\'s manifest dependencies.',
};
