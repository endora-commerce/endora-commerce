/**
 * R1 — a migration in `payment_methods` naming a table it does not declare
 * (feature 097, `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.1).
 *
 * Keyed `<file>:<table>`, two-way. Surfaced by issue #108, which taught the rule
 * to read DDL against an existing table; the DML half never saw this file. The
 * R2 half of the same statements is in
 * `scripts/ledgers/migration-foreign-writes/payment_methods.ts`, and one repair retires
 * both.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/payment_methods/src/migrations/20260611T140353_payment_methods_adapter.ts:payments':
    {
      sites: 2,
      reason:
        'Feature 034 widened the `payments` row into a payment-process record — `provider_details`, `failure_reason`, `attempt_no` — from this module\'s migration: one `alter table "payments"` in `up()` and its inverse in `down()`. The columns are `payments`\' own (`Payment.providerDetails` / `attemptNo`, `packages/modules/payments/src/backend/entities/payment.entity.ts`).\n\n' +
        '**A declaration is not the remedy: it would close a cycle.** ' +
        '`payments` names `payment_methods` in its `dependencies`, and this module already records the reverse edge as a `nonBindingDependencies` entry for exactly that reason (`packages/modules/payment_methods/src/manifest.ts`, D-44).\n\n' +
        '**Seam: `payments`\'s own migration.** Retired by moving the statements, verbatim and ' +
        'guarded with `if [not] exists`, into a `payments`-owned migration and deleting them from ' +
        'this file — the shape D-226 gave the `cms_pages` index this same family of frozen ' +
        'bodies carried (`Migration20260912T125709CmsPageBodyAssetRefIndex`). The stamp is ' +
        'below `BASELINE_THROUGH`, so that edits a frozen body every database has applied, ' +
        'and that is an owner ruling this entry holds open rather than pre-empting.',
    },
};
