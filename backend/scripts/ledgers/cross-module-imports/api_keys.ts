/**
 * Cross-module reaches still standing in `api_keys` (feature 075, FR-022…FR-026;
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
 * The 3 `sql:` entries below were seeded by D-87, on the day the second predicate
 * landed. They are not new couplings — they are couplings the check could not see, because
 * raw SQL names no import specifier. Each says which port retires it.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/api_keys/services/api-key-service.ts:sql:customer_accounts/customer_accounts':
    'D-87 seed — `api_keys` reads `customer_accounts`\'s `customer_accounts` table in raw ' +
    'SQL. The statement names no import specifier, so the boundary it crosses compiles ' +
    'and returns rows. Retired by: `customerAccountReadPort`, resolved through `lazyPort` ' +
    'with `customer_accounts` declared in this module\'s manifest dependencies.',
  'modules/api_keys/services/api-key-service.ts:sql:organizations/organizations':
    'D-87 seed — `api_keys` reads `organizations`\'s `organizations` table in raw SQL. The ' +
    'statement names no import specifier, so the boundary it crosses compiles and returns ' +
    'rows. Retired by: `organizationReadPort`, resolved through `lazyPort` with ' +
    '`organizations` declared in this module\'s manifest dependencies.',
};
