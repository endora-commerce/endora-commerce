/**
 * R2 — migrations in `price_lists` that write a table another module owns
 * (feature 097, `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.2).
 *
 * Keyed `<file>:<table>`, with `sites` where the file writes one table more than
 * once. Two-way: an unrecorded write fails the build, and an entry describing no
 * write fails it too. The entry is **DDL**, surfaced by issue #108, which taught
 * the rule to read `alter table`, `create index`, `drop index` and their kin.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/price_lists/src/migrations/20260426T075235_price_lists_pricing_init.ts:organizations':
    {
      sites: 4,
      reason:
        'The pricing init attached an organization to a customer group from this module\'s ' +
        'migration: `alter table "organizations" add column "customer_group_id"` and ' +
        '`organizations_customer_group_id_index` in `up()`, and the `drop index` and ' +
        '`drop column` in `down()`. The column is declared on `organizations`\' own entity ' +
        '(`packages/modules/organizations/src/backend/entities/organization.entity.ts`), so ' +
        'this module decided another module\'s schema. `price_lists` declares ' +
        '`organizations`, so R1 holds; R2 does not, and a declaration cannot make it.\n\n' +
        '**Seam: `organizations`\' own migration**, beside the entity property — or, if the ' +
        'reference is `price_lists`\' to keep, a `price_lists`-owned membership table, which ' +
        '`price-list-audience-member.entity.ts` already is for the newer audience model.\n\n' +
        'Retired by: moving the statements, verbatim and guarded with `if [not] exists`, ' +
        'into the owner\'s migration and deleting them from this file — the shape D-226 gave the ' +
        '`cms_pages` index `assets_library`\'s frozen init carried ' +
        '(`Migration20260912T125709CmsPageBodyAssetRefIndex`). `20260426T075235` is below ' +
        '`BASELINE_THROUGH`, so that edits a frozen body every database has applied — an owner ' +
        'ruling this entry holds open. Until then a new ' +
        'migration cannot retire it — the historical statements still run on every fresh ' +
        'database.',
    },
};
