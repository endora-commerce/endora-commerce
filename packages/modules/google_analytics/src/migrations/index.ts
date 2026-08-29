/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent. There is exactly one class here, which
 * is the case most likely to tempt an author into publishing the class alone and
 * calling it done — `blog` shipped `export *` on that reasoning until D-168, and
 * an installed `blog` stopped the platform from booting.
 *
 * One class means the intra-module order this array carries is trivial, and it
 * still is not the order the migration runs in: where this module's block sits
 * relative to every other module's is decided by the manifest `dependencies`
 * graph (feature 081), and this one names `sales_channels`, whose table the
 * `ga_custom_events` foreign key references.
 *
 * The **named** export stays, and the asymmetry with `./backend` — which
 * publishes an array and no named class (D-168) — is deliberate.
 * `db/migrations-registry.generated.ts` imports the class by name from this
 * specifier, and a migration class name is contract in a way an entity class
 * name is not: `mikro_orm_migrations` persists it, so it is a string every
 * already-migrated database holds.
 */

import { Migration20260715T171116GoogleAnalyticsInit } from './20260715T171116_google_analytics_init.js';

export const migrations = [Migration20260715T171116GoogleAnalyticsInit];

export { Migration20260715T171116GoogleAnalyticsInit };
