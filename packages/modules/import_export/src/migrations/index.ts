/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array, in ascending timestamp (feature 081).
 *
 * The named export stays beside the array: `db/migrations-registry.generated.ts`
 * imports each class by name, and a migration class name is persisted in
 * `mikro_orm_migrations`.
 */

import { Migration20261103T154219ImportExportImportProfiles } from './20261103T154219_import_export_import_profiles.js';

export const migrations = [Migration20261103T154219ImportExportImportProfiles];

export { Migration20261103T154219ImportExportImportProfiles };
