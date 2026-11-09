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

import { Migration20260718T200338CustomFieldsInit } from './20260718T200338_custom_fields_init.js';
import { Migration20261010T090000CustomFieldsDefinitionAudience } from './20261010T090000_custom_fields_definition_audience.js';
import { Migration20261019T103522CustomFieldsDefinitionListFilter } from './20261019T103522_custom_fields_definition_list_filter.js';
import { Migration20261020T110920CustomFieldsDefinitionCarryTo } from './20261020T110920_custom_fields_definition_carry_to.js';
import { Migration20261106T094044CustomFieldsDefinitionCustomerInputAdminAccess } from './20261106T094044_custom_fields_definition_customer_input_admin_access.js';

export const migrations = [
  Migration20260718T200338CustomFieldsInit,
  Migration20261010T090000CustomFieldsDefinitionAudience,
  Migration20261019T103522CustomFieldsDefinitionListFilter,
  Migration20261020T110920CustomFieldsDefinitionCarryTo,
  Migration20261106T094044CustomFieldsDefinitionCustomerInputAdminAccess,
];

export {
  Migration20260718T200338CustomFieldsInit,
  Migration20261010T090000CustomFieldsDefinitionAudience,
  Migration20261019T103522CustomFieldsDefinitionListFilter,
  Migration20261020T110920CustomFieldsDefinitionCarryTo,
  Migration20261106T094044CustomFieldsDefinitionCustomerInputAdminAccess,
};
