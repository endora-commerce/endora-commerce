/**
 * R2 — migrations in `organizations` that write a table another module owns
 * (feature 097, `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.2).
 *
 * Keyed `<file>:<table>`, two-way: an unrecorded write fails the build, and an
 * entry describing no write fails it too.
 *
 * The R1 half of this same statement is in
 * `scripts/ledgers/migration-undeclared-references/organizations.ts` and is
 * **permanent**; this one is not, and the difference is the point. R1 asks
 * whether the edge may be declared, and for this pair it may not — the reverse
 * edge exists and a declaration closes a cycle. R2 asks who decides what is in
 * the table, and that question has an answer.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/organizations/src/migrations/20260717T151403_organizations_personal_organizations.ts:customer_accounts':
    'The `down()` half of feature 051\'s personal-organization backfill: it clears ' +
    '`customer_accounts.organization_id` on the accounts this migration re-parented, then ' +
    'removes the organizations it created. The `up()` half only **reads** the table and is ' +
    'therefore not an R2 finding — a cross-module read is legitimate under a declaration, ' +
    'and only a write is not made legitimate by one.\n\n' +
    '**Seam: `customer_accounts`\' own migration**, or rather its absence of one — the ' +
    'honest shape here is that a rollback which un-does a two-module change has to touch ' +
    'both modules\' rows, and this repository has never decided how a `down()` spanning two ' +
    'owners is written. Neither of `specs/097-migration-sql-boundary/research.md` §8\'s two adapter seams applies: an ' +
    '`installHook` has no uninstall-time twin that runs during a migration rollback, and ' +
    'the owner cannot write a `down()` for a migration it does not own.\n\n' +
    'Retired by: an owner ruling on cross-module `down()`, which nobody has taken and which ' +
    'this entry holds open rather than pre-empting. Note that `20260717T151403` is below ' +
    '`BASELINE_THROUGH` and applied everywhere, so whatever is ruled has to be a no-op for a ' +
    'database that already ran it.',
};
