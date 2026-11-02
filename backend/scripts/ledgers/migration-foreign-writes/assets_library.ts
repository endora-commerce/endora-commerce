/**
 * R2 — migrations in `assets_library` that write a table another module owns
 * (feature 097, `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.2).
 *
 * Keyed `<file>:<table>`, with `sites` where the file writes one table more than
 * once. Two-way: an unrecorded write fails the build, and an entry describing no
 * write fails it too. The entry is **DDL**, surfaced by issue #108, which taught
 * the rule to read `alter table`, `create index`, `drop index` and their kin.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/assets_library/src/migrations/20260505T102206_assets_library_init.ts:categories':
    {
      sites: 5,
      reason:
        'Feature 013 gave a catalogue category a main image from the assets library, and ' +
        'added the column from this module\'s migration: `alter table "categories" add column ' +
        '"main_image_asset_id"` with `categories_main_image_fk` to `assets`, ' +
        '`categories_main_image_asset_id_index`, and the three inverse statements in `down()` ' +
        '(the `drop index` is attributed through the `create index` that names the table). ' +
        'The column is `catalog`\'s — `Category.mainImageAssetId` declares it — so the schema ' +
        'of another module\'s table is decided here.\n\n' +
        '**Seam: `catalog`\'s own migration.** The column, its index and its constraint belong ' +
        'beside the entity property that declares them; the foreign key to `assets` is a ' +
        'reference `catalog` already declares through its `assets_library` dependency.\n\n' +
        'Retired by: moving the statements, verbatim and guarded with `if [not] exists`, ' +
        'into the owner\'s migration and deleting them from this file — the shape D-226 gave the ' +
        '`cms_pages` index `assets_library`\'s frozen init carried ' +
        '(`Migration20260912T125709CmsPageBodyAssetRefIndex`). `20260505T102206` is below ' +
        '`BASELINE_THROUGH`, so that edits a frozen body every database has applied — an owner ' +
        'ruling this entry holds open. Until then a new ' +
        '`catalog` migration cannot retire it — the historical statements still run on every ' +
        'fresh database. The R1 half is in ' +
        '`scripts/ledgers/migration-undeclared-references/assets_library.ts`.',
    },
};
