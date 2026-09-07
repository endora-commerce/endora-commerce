/**
 * R2 — migrations in `customer_accounts` that write a table another module owns
 * (feature 097, `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.2).
 *
 * Keyed `<file>:<table>`, two-way: an unrecorded write fails the build, and an
 * entry describing no write fails it too.
 *
 * **This ledger is expected to drain.** A declared dependency answers "must that
 * module be installed, and does its schema run first"; it does not answer "who
 * decides what is in that table". The entry below names the seam its repair
 * takes, not merely what the finding is.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/customer_accounts/src/migrations/20260825T141659_customer_accounts_organization_required.ts:organizations':
    'D-178 — `customer_accounts.organization_id` becomes `NOT NULL`, and the migration ' +
    'provisions a personal `organizations` row for every account still without one before ' +
    'it adds the constraint. The provision has to happen inside this migration\'s ' +
    'transaction, immediately before the `alter table`, or the constraint fails on rows the ' +
    'owner has not yet been asked about; that much is right and is not what this entry ' +
    'records.\n\n' +
    'What it records is that a row in `organizations` is decided here rather than by the ' +
    'module that owns the table, which knows what a personal organization is and what it ' +
    'should be called. The shape of the row — the derived name, the `tax_id` taken from the ' +
    'account id, `vat_status: vat_exempt`, the placeholder address — is `organizations`\' ' +
    'business, and it is written twice in this repository: once here and once in ' +
    '`organizations`\' own `20260717T151403` backfill, which produced the same row shape ' +
    'from the other side. Two copies of one definition are what R2 is about.\n\n' +
    '**Seam: `organizations`\' own migration.** That module already ships the backfill; a ' +
    'later `organizations`-owned migration provisioning any remaining account-shaped orphan ' +
    'would run before this one, because this module declares `organizations` in its ' +
    '`dependencies` and feature 081 orders the two along that edge. The `alter table` here ' +
    'then has nothing left to provision and keeps only its refusal.\n\n' +
    'Retired by: `organizations` shipping the provisioning half, with this migration\'s ' +
    '`up()` reduced to the count-and-refuse it already carries. The stamp is above ' +
    '`BASELINE_THROUGH`, so the edit is available; it has to leave a database that already ' +
    'ran it unchanged, which it does — the provision is idempotent and matches nothing on a ' +
    'second pass.',
};
