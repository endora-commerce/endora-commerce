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
 * The **named** exports stay beside the array, and the asymmetry with
 * `./backend` — which publishes an array and no named class (D-168) — is
 * deliberate. `db/migrations-registry.generated.ts` imports each class by name
 * from this specifier, and a migration class name is contract in a way an entity
 * class name is not: `mikro_orm_migrations` persists it, so it is a string every
 * already-migrated database holds.
 *
 * A class that is in neither the array nor the barrel is a migration that does
 * not run: `migration:pending` reports nothing pending and the first symptom is
 * a query against a table nobody created.
 */

import { Migration20260629T200954NewsletterInit } from './20260629T200954_newsletter_init.js';
import { Migration20260830T212736NewsletterOrganizationAttribution } from './20260830T212736_newsletter_organization_attribution.js';
import { Migration20260903T101752NewsletterNamespaceBlockNames } from './20260903T101752_newsletter_namespace_block_names.js';

export const migrations = [
  Migration20260629T200954NewsletterInit,
  Migration20260830T212736NewsletterOrganizationAttribution,
  Migration20260903T101752NewsletterNamespaceBlockNames,
];

export {
  Migration20260629T200954NewsletterInit,
  Migration20260830T212736NewsletterOrganizationAttribution,
  Migration20260903T101752NewsletterNamespaceBlockNames,
};
