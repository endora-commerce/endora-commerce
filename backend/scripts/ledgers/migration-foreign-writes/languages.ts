/**
 * R2 — migrations in `languages` that write a table another module owns
 * (feature 097, `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.2).
 *
 * Keyed `<file>:<table>`, two-way: an unrecorded write fails the build, and an
 * entry describing no write fails it too.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/languages/src/migrations/20260425T161557_languages_currencies_init.ts:currencies':
    'The two shipped currency rows — `PLN` and `EUR` — inserted by a migration named for, ' +
    'and owned by, `languages`. Its own doc block says why the file is shaped this way: the ' +
    'two configuration tables were "co-located in the `languages` module folder to keep the ' +
    'migration sequence numerical without inventing a third placeholder module". That ' +
    'reason retired with feature 065 — there is no repo-wide sequence to keep numerical any ' +
    'more, and `currencies` is a module of its own with its own `migrations/` directory.\n\n' +
    'The `create table "currencies"` in the same file is DDL and is ' +
    '`test/unit/db/fk-dependency-drift.test.ts`\' subject, not this rule\'s; what this entry ' +
    'records is the `insert`, which decides what is in another module\'s table.\n\n' +
    '**Seam: `currencies`\' own migration.** Nothing about these two rows needs `languages`: ' +
    'they are the owner\'s shipped reference data, they are the rows the owner\'s own ' +
    '`is_default` partial unique index exists for, and the owner has a migration directory ' +
    'to put them in.\n\n' +
    'Retired by: `currencies` owning both the table and its seed. The stamp is ' +
    '`20260425T161557`, below `BASELINE_THROUGH`, so the historical file cannot be reordered ' +
    'and its `insert` cannot simply move — a replacement has to leave every database that ' +
    'has applied it byte-identical, which for two `on conflict`-less inserts means the ' +
    'owner\'s migration guards on the rows already being there.',
};
