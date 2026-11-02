/**
 * R2 — migrations in `payment_methods` that write a table another module owns
 * (feature 097, `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.2).
 *
 * Keyed `<file>:<table>`, with `sites` where the file writes one table more than
 * once. Two-way: an unrecorded write fails the build, and an entry describing no
 * write fails it too. The entry is **DDL**, surfaced by issue #108, which taught
 * the rule to read `alter table`, `create index`, `drop index` and their kin.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/payment_methods/src/migrations/20260611T140353_payment_methods_adapter.ts:payments':
    {
      sites: 2,
      reason:
        'Feature 034\'s adapter framework widened the `payments` row — `provider_details`, ' +
        '`failure_reason`, `attempt_no` — in one `alter table "payments"` in `up()` and its ' +
        'inverse in `down()`. The columns are `payments`\' own (`Payment.providerDetails`, ' +
        '`Payment.attemptNo`), so this module decided another module\'s schema.\n\n' +
        '**Seam: `payments`\' own migration**, beside the entity properties that declare the ' +
        'columns. `payments` already declares `payment_methods`, so the move costs no new ' +
        'edge.\n\n' +
        'Retired by: moving the statements, verbatim and guarded with `if [not] exists`, ' +
        'into the owner\'s migration and deleting them from this file — the shape D-226 gave the ' +
        '`cms_pages` index `assets_library`\'s frozen init carried ' +
        '(`Migration20260912T125709CmsPageBodyAssetRefIndex`). `20260611T140353` is below ' +
        '`BASELINE_THROUGH`, so that edits a frozen body every database has applied — an owner ' +
        'ruling this entry holds open. Until then a new ' +
        '`payments` migration cannot retire it — the historical statement still runs on every ' +
        'fresh database. The R1 half is in ' +
        '`scripts/ledgers/migration-undeclared-references/payment_methods.ts`.',
    },
};
