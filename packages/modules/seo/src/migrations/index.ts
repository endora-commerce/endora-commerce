/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * **One class**, stamped inside the frozen historical prefix
 * (`BASELINE_THROUGH`, `db/migration-order.ts`), so its position is history and
 * the manifest graph does not move it.
 *
 * The **named** export stays beside the array, and the asymmetry with
 * `./backend` — which publishes an array and no named class (D-168) — is
 * deliberate. `db/migrations-registry.generated.ts` imports the class by name
 * from this specifier, and a migration class name is contract in a way an
 * entity class name is not: `mikro_orm_migrations` persists it, so it is a
 * string every already-migrated database holds.
 */

import { Migration20260425T154404SeoInit } from './20260425T154404_seo_init.js';

export const migrations = [Migration20260425T154404SeoInit];

export { Migration20260425T154404SeoInit };
