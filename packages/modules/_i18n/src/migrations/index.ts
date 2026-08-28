/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * **One class**, and it creates the `translation_bundles` table together with
 * the `translation_bundles_version_seq` sequence the resolver's cache
 * invalidation reads. Its position relative to every other module's is decided
 * by the manifest `dependencies` graph (feature 081); the timestamp orders this
 * module's own migrations and nothing else.
 *
 * The **named** export stays beside the array. `db/migrations-registry.generated.ts`
 * imports the class by name from this specifier, and a migration class name is
 * contract in a way an entity class name is not: `mikro_orm_migrations` persists
 * it, so it is a string every already-migrated database holds.
 */

import { Migration20260507T091405I18nAdminI18nInit } from './20260507T091405_i18n_admin_i18n_init.js';

export const migrations = [Migration20260507T091405I18nAdminI18nInit];

export { Migration20260507T091405I18nAdminI18nInit };
