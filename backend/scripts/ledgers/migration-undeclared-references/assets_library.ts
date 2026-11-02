/**
 * R1 — a migration in `assets_library` naming a table it does not declare
 * (feature 097, `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.1).
 *
 * Keyed `<file>:<table>`, two-way. Surfaced by issue #108, which taught the rule
 * to read DDL against an existing table; the DML half never saw this file. The
 * R2 half of the same statements is in
 * `scripts/ledgers/migration-foreign-writes/assets_library.ts`, and one repair retires
 * both.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/assets_library/src/migrations/20260505T102206_assets_library_init.ts:categories':
    {
      sites: 5,
      reason:
        'The migration adds `categories.main_image_asset_id` with its foreign key to `assets` and its index in `up()`, and drops all three in `down()` — five DDL statements against a table `catalog` owns (`Category.mainImageAssetId`, `packages/modules/catalog/src/backend/entities/category.entity.ts`).\n\n' +
        '**A declaration is not the remedy: it would close a cycle.** ' +
        '`catalog` names `assets_library` in its own `dependencies` (`packages/modules/catalog/src/manifest.ts`), so declaring `catalog` here makes a 2-cycle that `backend/test/unit/db/module-graph.test.ts` reds and the `_lifecycle` orchestrator refuses (`manifest-cycle`). The kept direction is the right one: the catalogue uses assets, not the other way round.\n\n' +
        '**Seam: `catalog`\'s own migration.** Retired by moving the statements, verbatim and ' +
        'guarded with `if [not] exists`, into a `catalog`-owned migration and deleting them from ' +
        'this file — the shape D-226 gave the `cms_pages` index this same family of frozen ' +
        'bodies carried (`Migration20260912T125709CmsPageBodyAssetRefIndex`). The stamp is ' +
        'below `BASELINE_THROUGH`, so that edits a frozen body every database has applied, ' +
        'and that is an owner ruling this entry holds open rather than pre-empting.',
    },
};
