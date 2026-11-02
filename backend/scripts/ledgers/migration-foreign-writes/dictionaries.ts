/**
 * R2 — migrations in `dictionaries` that write a table another module owns
 * (feature 097, `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.2).
 *
 * Keyed `<file>:<table>`, with `sites` where the file writes one table more than
 * once. Two-way: an unrecorded write fails the build, and an entry describing no
 * write fails it too. Both entries are **DDL**, surfaced by issue #108, which
 * taught the rule to read `alter table`, `create index`, `drop index` and their
 * kin.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

/** Why neither entry can be repaired where it stands, said once. */
const FROZEN =
  'Retired by: moving the statements, verbatim and guarded with `if [not] exists`, ' +
  'into the owner\'s migration and deleting them from this file — the shape D-226 gave the ' +
  '`cms_pages` index `assets_library`\'s frozen init carried ' +
  '(`Migration20260912T125709CmsPageBodyAssetRefIndex`). `20260506T112634` is below ' +
  '`BASELINE_THROUGH`, so that edits a frozen body every database has applied — an owner ' +
  'ruling this entry holds open. Until then a new ' +
  'migration in the owner cannot retire it — the historical statements still run on every ' +
  'fresh database. `dictionaries` declares both owners, so R1 holds; R2 does not, and a ' +
  'declaration cannot make it.';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/dictionaries/src/migrations/20260506T112634_dictionaries_dictionary_init.ts:languages':
    {
      sites: 8,
      reason:
        'Feature 017 extended `languages` from the dictionary module\'s migration: three ' +
        '`alter table "languages" add column` statements (`native_label`, `is_rtl`, ' +
        '`fallback_code`) and the `languages_fallback_fk` self-reference in `up()`, and the ' +
        'four inverse statements in `down()`. The columns are `languages`\' own ' +
        '(`Language.nativeLabel` / `isRtl` / `fallbackCode`).\n\n' +
        '**Seam: `languages`\' own migration**, beside the entity properties that declare the ' +
        'columns.\n\n' +
        FROZEN,
    },
  'packages/modules/dictionaries/src/migrations/20260506T112634_dictionaries_dictionary_init.ts:currencies':
    {
      sites: 8,
      reason:
        'Feature 017 extended `currencies` from the same migration: two `alter table ' +
        '"currencies" add column` statements (`symbol_position`, `decimal_places`) and the two ' +
        '`check` constraints guarding them in `up()`, and the four inverse statements in ' +
        '`down()`. The columns are `currencies`\' own (`Currency.symbolPosition` / ' +
        '`decimalPlaces`).\n\n' +
        '**Seam: `currencies`\' own migration**, beside the entity properties that declare the ' +
        'columns.\n\n' +
        FROZEN,
    },
};
