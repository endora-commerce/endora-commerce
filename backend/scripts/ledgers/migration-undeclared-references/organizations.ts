/**
 * R1 — a migration in `organizations` naming a table it does not declare
 * (feature 097, `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.1).
 *
 * Keyed `<file>:<table>`. Not `(file, target)`: a migration may name two of one
 * owner's tables for different reasons and the entry has to say which. Not
 * `(file, line)`: a line-keyed entry reds on any insertion above the site.
 *
 * Two-way, like every ledger in this tree: an unrecorded finding fails the
 * build, and an entry describing no finding fails it too.
 *
 * **This ledger is not expected to empty**, and its one entry is why: it records
 * an edge no manifest can express, not a repair nobody has got to yet.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/organizations/src/migrations/20260717T151403_organizations_personal_organizations.ts:customer_accounts':
    {
      permanent: true,
      sites: 2,
      reason:
        'Feature 051 gave every transacting customer an organization, and this migration is ' +
        'the backfill. Two statements name the table: `up()`\'s CTE selects `from ' +
        '"customer_accounts"` to find the accounts that have none, and `down()` clears ' +
        '`customer_accounts.organization_id` on the rows it created organizations for. ' +
        'Three facts make the pair permanent rather than debt, and each is checkable.\n\n' +
        '**A declaration would close a cycle.** `customer_accounts` names `organizations` in ' +
        'its own `dependencies` (`packages/modules/customer_accounts/src/manifest.ts:37`), so ' +
        'adding `customer_accounts` to this module\'s `dependencies` makes a 2-cycle, which ' +
        '`backend/test/unit/db/module-graph.test.ts` reds and which the `_lifecycle` ' +
        'orchestrator refuses for an arriving module (`manifest-cycle`, exit 65). The kept ' +
        'direction is the tenancy one and that is a ruling, not an accident.\n\n' +
        '**The migration cannot be edited.** Its stamp, `20260717T151403`, is below ' +
        '`BASELINE_THROUGH` (`20260801T000000`, `backend/src/db/migration-order.ts`), so it ' +
        'sits in the frozen historical prefix; and every database that has applied it stores ' +
        'the class name, so it cannot be renamed or replaced either (AGENTS.md ' +
        '§ *Migrations* item 5).\n\n' +
        '**The same edge is already acknowledged one predicate over.** ' +
        '`backend/test/unit/db/acknowledged-fk-edges.ts:94-105` holds `organizations → ' +
        'customer_accounts` with `via: [\'email_verification_tokens → customer_accounts\']` ' +
        'and the same reasoning, for the DDL half of the identical rule. This entry is that ' +
        'entry\'s DML twin; it is **cited** rather than copied, so a change of mind there is ' +
        'a change of mind a reader can follow rather than two sentences drifting apart.',
      retiredBy:
        'A manifest field expressing **order without bind** — "run `customer_accounts`\' ' +
        'migrations first, and do not make this module a dependent" — which is the fourth ' +
        'quadrant `packages/contracts/src/modules.ts` records as deliberately unspellable ' +
        'above `ModuleNonBindingDependencySchema`, and which D-113 withdrew. Until an owner ' +
        're-opens that, there is no declaration this migration could carry, and the entry ' +
        'stands. `acknowledgedDependencies` is not it: it carries the bind and drops the ' +
        'ordering, which is the wrong half for a migration.',
    },
};
