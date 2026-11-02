/**
 * R2 — migrations in `carts` that write a table another module owns
 * (feature 097, `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.2).
 *
 * Keyed `<file>:<table>`, with `sites` where the file writes one table more than
 * once. Two-way: an unrecorded write fails the build, and an entry describing no
 * write fails it too. The entry is **DDL**, surfaced by issue #108, which taught
 * the rule to read `alter table`, `create index`, `drop index` and their kin.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/carts/src/migrations/20260611T140352_carts_consolidation.ts:organizations':
    {
      sites: 2,
      reason:
        'The per-organization cart-approval policy: `alter table "organizations" add column ' +
        '"requires_cart_approval"` in `up()` (step 9) and the matching `drop column` in ' +
        '`down()`. The column is `organizations`\' — `Organization.requiresCartApproval` ' +
        'declares it — so this module decided another module\'s schema. `carts` declares ' +
        '`organizations`, so R1 holds; R2 does not, and a declaration cannot make it.\n\n' +
        '**Seam: `organizations`\' own migration**, beside the entity property that declares ' +
        'the column.\n\n' +
        'Retired by: moving the statements, verbatim and guarded with `if [not] exists`, ' +
        'into the owner\'s migration and deleting them from this file — the shape D-226 gave the ' +
        '`cms_pages` index `assets_library`\'s frozen init carried ' +
        '(`Migration20260912T125709CmsPageBodyAssetRefIndex`). `20260611T140352` is below ' +
        '`BASELINE_THROUGH`, so that edits a frozen body every database has applied — an owner ' +
        'ruling this entry holds open. Until then a new ' +
        '`organizations` migration cannot retire it — the historical statement still runs on ' +
        'every fresh database.',
    },
};
