/**
 * R2 — migrations in `dictionaries` that write a table another module owns
 * (feature 097, `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.2).
 *
 * Keyed `<file>:<table>`, with `sites` where the file writes one table more than
 * once. Two-way: an unrecorded write fails the build, and an entry describing no
 * write fails it too. The entry is **DDL**, surfaced by issue #108, which
 * taught the rule to read `alter table`, `create index`, `drop index` and their
 * kin. Its `languages` twin was retired by issue #611, which moved those
 * statements to `Migration20261114T003519LanguagesDictionaryColumns`.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/dictionaries/src/migrations/20260506T112634_dictionaries_dictionary_init.ts:currencies':
    {
      sites: 8,
      reason:
        'Feature 017 extended `currencies` from the dictionary module\'s migration: two `alter table ' +
        '"currencies" add column` statements (`symbol_position`, `decimal_places`) and the two ' +
        '`check` constraints guarding them in `up()`, and the four inverse statements in ' +
        '`down()`. The columns are `currencies`\' own (`Currency.symbolPosition` / ' +
        '`decimalPlaces`).\n\n' +
        '**Seam: `currencies`\' own migration**, beside the entity properties that declare the ' +
        'columns — **but not yet.** `currencies` does not create its own table: ' +
        '`languages`\' frozen `Migration20260425T161557LanguagesCurrenciesInit` does, and ' +
        '`languages` declares `currencies`, not the other way round. So a `currencies`-owned ' +
        'migration altering the table runs, in an instance\'s module-by-module order, before ' +
        'the table exists, and `test/unit/db/instance-migration-order.test.ts` G4 refuses it ' +
        '(D-226: a migration names only what its own closure creates). Issue #611 moved the ' +
        '`languages` half of this file and left this one for that reason.\n\n' +
        'Retired by: `currencies` creating its own table first — the `create table ' +
        '"currencies"` in that same `languages` init, whose seed is the `languages` → ' +
        '`currencies` R2 entry in `scripts/ledgers/migration-foreign-writes/languages.ts`; it is ' +
        'frozen and referenced by frozen migrations, so moving it is an owner ruling of its ' +
        'own — and then moving these statements, verbatim and guarded with `if [not] ' +
        'exists`, into that module\'s migration and deleting them from this file. ' +
        '`20260506T112634` is below `BASELINE_THROUGH`, so that edits a frozen body every ' +
        'database has applied. `dictionaries` declares `currencies`, so R1 holds; R2 does not, ' +
        'and a declaration cannot make it.',
    },
};
