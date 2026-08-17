/**
 * Cross-module reaches still standing in `megamenu` (feature 075, FR-022…FR-026;
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
  'modules/megamenu/services/megamenu-service.ts:sql:kernel/sales_channels':
    'D-87 seed — `megamenu` reads the kernel\'s `sales_channels` table in raw SQL, so the ' +
    'read is invisible to the import predicate and to the request-channel resolver alike. ' +
    'Retired by: the resolved request channel plus `salesChannelsCache` / ' +
    '`salesChannelsService`, whichever the statement is actually asking for.',
};
