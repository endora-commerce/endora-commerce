/**
 * Cross-module reaches still standing in `admin_actions` (feature 075,
 * FR-022…FR-026; feature 077, D-87; issue #187).
 *
 * Keyed `<path under src/>:<target module>/<target path>` for an import and
 * `<path under src/>:sql:<owner>/<table>` for a raw statement or a query builder, so
 * moving code inside a file does not invalidate an entry and re-opening a hole does not
 * silently inherit one.
 *
 * Two-way: an unledgered reach fails the build, and an entry that no longer describes one
 * fails it too. Delete this file when the last entry goes; an empty shard is refused,
 * because a done signal that says nothing is not one.
 *
 * The shard exists because of issue #187: the reach below is a knex `join`, which names
 * its table as a call argument, so neither the import predicate nor D-87's statement path
 * could see it. It is not a new coupling — it is a coupling the check could not see.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/admin_actions/services/admin-actions-service.ts:sql:kernel/module_registrations':
    'Issue #187 seed — the palette query joins the kernel\'s `module_registrations` table ' +
    'to keep actions whose module is not installed out of the result, and it does so with ' +
    'a knex `.join(\'module_registrations as r\', …)`. The builder names the table as an ' +
    'argument, so the reach compiles and returns rows while naming no import specifier and ' +
    'no SQL statement.\n\n' +
    'Two facts the seed did not have, measured while draining the `customers`, ' +
    '`organizations`, `admin_users`, `admin_actions` and `api_keys` shards.\n\n' +
    '(1) **This join is the one presence gate `withModuleOff` cannot move.** That helper ' +
    'flips `registryCache.__setEnabledForTesting` and touches neither Redis nor the ' +
    'database (`test/helpers/off-state.ts`, and deliberately — 555 files boot a server in ' +
    'one fork), so a `platform-unavailable` flip is invisible to a read that goes to SQL ' +
    'for the platform axis. Every other surface in the tree answers the same question out ' +
    'of `effectiveState`; the palette answers it out of a table.\n\n' +
    '(2) **The cut is a behaviour change four test files encode as the contract, not a ' +
    'specifier swap.** `operator-visibility`, `seeded-set`, `i18n-resolution` and ' +
    '`http-admin-actions` each insert `module_registrations` rows and assert the palette ' +
    'against them without warming the cache, and ' +
    '`presence-refresh-window.integration.test.ts` exists *because* the two axes come from ' +
    'different sources with different timing — it measures the window between an ' +
    'in-memory activation read and an asynchronous `refreshFromDb`, which is issue #225\'s ' +
    'repair. Unifying both axes onto `effectiveState.isPresent` deletes that window rather ' +
    'than closing it.\n\n' +
    'Retired by: filtering the actions against the kernel\'s effective-state combiner — the ' +
    'in-memory answer every other gate already uses — taken together with a decision on ' +
    'what issue #225\'s refresh window means once the platform axis stops being read ' +
    'freshly per call. That is this module\'s owner\'s call, not a boundary sweep\'s.',
};
