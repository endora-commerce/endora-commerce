/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * **One class.** It creates the `languages` table and the `currencies` table
 * together — the two shipped as one migration long before either module was a
 * package — so `currencies` owns rows this file creates and ships no migration
 * of its own. That is a fact about history, not an ordering rule: a timestamp
 * orders this module's own migrations and nothing else (feature 081), and where
 * this block sits relative to every other module's is decided by the manifest
 * `dependencies` graph.
 *
 * The **named** export stays beside the array, and the asymmetry with
 * `./backend` — which publishes an array and no named class (D-168) — is
 * deliberate. `db/migrations-registry.generated.ts` imports the class by name
 * from this specifier, and a migration class name is contract in a way an
 * entity class name is not: `mikro_orm_migrations` persists it, so it is a
 * string every already-migrated database holds.
 */

import { Migration20260425T161557LanguagesCurrenciesInit } from './20260425T161557_languages_currencies_init.js';

export const migrations = [Migration20260425T161557LanguagesCurrenciesInit];

export { Migration20260425T161557LanguagesCurrenciesInit };
