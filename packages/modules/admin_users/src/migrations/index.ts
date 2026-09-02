/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * Listed in ascending timestamp, which orders **this module's own** migrations
 * and nothing else (feature 081). Where the block sits relative to every other
 * module's is decided by the manifest `dependencies` graph.
 *
 * The **named** exports stay, and the asymmetry with `./backend` — which
 * publishes an array and no entity class by name (D-168) — is deliberate.
 * `db/migrations-registry.generated.ts` imports each class by name from this
 * specifier, and a migration class name is contract in a way an entity class
 * name is not: `mikro_orm_migrations` persists it, so it is a string every
 * already-migrated database holds.
 *
 * A class that is in neither the array nor the barrel is a migration that does
 * not run: `migration:pending` reports nothing pending and the first symptom
 * is a query against a table nobody created.
 */

import { Migration20260425T053028AdminUsersInit } from './20260425T053028_admin_users_init.js';
import { Migration20260819T155150AdminUsersFoldEmailCase } from './20260819T155150_admin_users_fold_email_case.js';
import { Migration20260825T124801AdminUsersDropLegacyTwoFactorSecret } from './20260825T124801_admin_users_drop_legacy_two_factor_secret.js';

export const migrations = [
  Migration20260425T053028AdminUsersInit,
  Migration20260819T155150AdminUsersFoldEmailCase,
  Migration20260825T124801AdminUsersDropLegacyTwoFactorSecret,
];

export {
  Migration20260425T053028AdminUsersInit,
  Migration20260819T155150AdminUsersFoldEmailCase,
  Migration20260825T124801AdminUsersDropLegacyTwoFactorSecret,
};
