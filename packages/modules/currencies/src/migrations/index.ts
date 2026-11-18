/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * Listed in ascending timestamp, which is the order of this module's own
 * migrations and of nothing else (feature 081): a manifest `dependencies` array
 * is the only thing ordering this block against another module's.
 *
 * **Until issue #611 this module shipped no migration.** `languages`' frozen
 * `Migration20260425T161557LanguagesCurrenciesInit` created the `currencies`
 * table and inserted its two shipped rows, and `dictionaries`' frozen
 * `Migration20260506T112634DictionariesDictionaryInit` added
 * `symbol_position`, `decimal_places` and their checks. The first class here
 * now owns all of it.
 *
 * The **named** exports stay beside the array, and the asymmetry with
 * `./backend` — which publishes an array and no named class (D-168) — is
 * deliberate. `db/migrations-registry.generated.ts` imports each class by name
 * from this specifier, and a migration class name is contract in a way an entity
 * class name is not: `mikro_orm_migrations` persists it, so it is a string every
 * already-migrated database holds.
 */

import { Migration20261117T065542CurrenciesTable } from './20261117T065542_currencies_table.js';

export const migrations = [
  Migration20261117T065542CurrenciesTable,
];

export {
  Migration20261117T065542CurrenciesTable,
};
