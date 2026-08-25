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

import { Migration20260425T091359WebhooksUs7Init } from './20260425T091359_webhooks_us7_init.js';
import { Migration20260724T203140WebhooksOrgFilter } from './20260724T203140_webhooks_org_filter.js';
import { Migration20260727T200555WebhooksDropExternalIntegrations } from './20260727T200555_webhooks_drop_external_integrations.js';

export const migrations = [
  Migration20260425T091359WebhooksUs7Init,
  Migration20260724T203140WebhooksOrgFilter,
  Migration20260727T200555WebhooksDropExternalIntegrations,
];

export {
  Migration20260425T091359WebhooksUs7Init,
  Migration20260724T203140WebhooksOrgFilter,
  Migration20260727T200555WebhooksDropExternalIntegrations,
};
