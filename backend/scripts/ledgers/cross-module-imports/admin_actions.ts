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
export const entries: Readonly<Record<string, string>> = {
  'modules/admin_actions/services/admin-actions-service.ts:sql:kernel/module_registrations':
    'Issue #187 seed — the palette query joins the kernel\'s `module_registrations` table ' +
    'to keep actions whose module is not installed out of the result, and it does so with ' +
    'a knex `.join(\'module_registrations as r\', …)`. The builder names the table as an ' +
    'argument, so the reach compiles and returns rows while naming no import specifier and ' +
    'no SQL statement. Retired by: filtering the actions against the kernel\'s ' +
    '`ModuleRegistryCache` (or the effective-state combiner, if the palette should also ' +
    'drop the actions of a module the operator has switched off) instead of joining the ' +
    'registry table — the in-memory answer the kernel already keeps for every other gate.',
};
