/**
 * Cross-module reaches still standing in `price_lists` (feature 075, FR-022…FR-026;
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
 * The 2 `sql:` entries below were seeded by D-87, on the day the second predicate
 * landed. They are not new couplings — they are couplings the check could not see, because
 * raw SQL names no import specifier. Each says which port retires it.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/price_lists/services/price-list-service.ts:sql:catalog/product_categories':
    'D-87 seed — `price_lists` reads `catalog`\'s `product_categories` table in raw SQL. ' +
    'The statement names no import specifier, so the boundary it crosses compiles and ' +
    'returns rows. Retired by: `catalogCategoryReadPort`, resolved through `lazyPort` ' +
    'with `catalog` declared in this module\'s manifest dependencies.',
  'modules/price_lists/services/pricing-service.ts:sql:catalog/product_categories':
    'D-87 seed — `price_lists` reads `catalog`\'s `product_categories` table in raw SQL. ' +
    'The statement names no import specifier, so the boundary it crosses compiles and ' +
    'returns rows. Retired by: `catalogCategoryReadPort`, resolved through `lazyPort` ' +
    'with `catalog` declared in this module\'s manifest dependencies.',
};
