/**
 * `organizations`' test support (`@endora-commerce/test-kit/support`): the
 * tables of this module whose rows must not survive from one test file into the
 * next.
 *
 * **Why the sales-rep assignments are here (issue #1056).** Since spec 175
 * (#305) a sales representative reaches every Organization nobody is assigned
 * to, so an assignment row is not inert data: it narrows what every *other*
 * representative reaches. The table has no foreign key to `organizations`, so
 * the harness's truncate of `organizations` never cascaded into it, and a row a
 * file seeded for `TEST_ORGANIZATION_ID` stood for every later file on the same
 * worker database. A case could then pass only because an earlier file in its
 * shard had left an assignment behind (#1019). A test that needs an assignment
 * writes its own.
 *
 * **Why the governor is here too.** `organization_reach_governor` is derived:
 * the statement-level triggers of `Migration20261109T144721OrganizationsReachGovernor`
 * recompute it from the assignments and the organizations' paths, and the
 * truncate trigger on either source table rebuilds it from scratch. So emptying
 * the two sources would empty it anyway; it is named so that the reset does not
 * depend on a trigger a later migration might change, and because a derived row
 * left stale widens reach rather than narrowing it.
 */
export const volatileTables: readonly string[] = [
  'organization_sales_rep_assignments',
  'organization_reach_governor',
];
