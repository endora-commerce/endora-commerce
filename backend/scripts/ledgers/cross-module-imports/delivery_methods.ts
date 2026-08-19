/**
 * Cross-module reaches still standing in `delivery_methods` (feature 075, FR-022…FR-026;
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
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/delivery_methods/commands/delivery-method.commands.ts:sql:shipments/shipments':
    'D-87 seed — `delivery_methods` reads `shipments`\'s `shipments` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `shipmentService`, resolved through `lazyPort` with `shipments` ' +
    'declared in this module\'s manifest dependencies.',
};
