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

import { Migration20260426T081516TaxesPromotionsInit } from './20260426T081516_taxes_promotions_init.js';
import { Migration20260912T094654TaxesSalesChannelTaxes } from './20260912T094654_taxes_sales_channel_taxes.js';

export const migrations = [
  Migration20260426T081516TaxesPromotionsInit,
  Migration20260912T094654TaxesSalesChannelTaxes,
];

export {
  Migration20260426T081516TaxesPromotionsInit,
  Migration20260912T094654TaxesSalesChannelTaxes,
};
