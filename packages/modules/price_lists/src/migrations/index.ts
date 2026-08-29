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

import { Migration20260426T075235PriceListsPricingInit } from './20260426T075235_price_lists_pricing_init.js';
import { Migration20260504T125655PriceListsEngine } from './20260504T125655_price_lists_engine.js';
import { Migration20260817T055457PriceListsSingleSystemPriceList } from './20260817T055457_price_lists_single_system_price_list.js';
import { Migration20260821T135907PriceListsUnitPriceAmountIndex } from './20260821T135907_price_lists_unit_price_amount_index.js';

export const migrations = [
  Migration20260426T075235PriceListsPricingInit,
  Migration20260504T125655PriceListsEngine,
  Migration20260817T055457PriceListsSingleSystemPriceList,
  Migration20260821T135907PriceListsUnitPriceAmountIndex,
];

export {
  Migration20260426T075235PriceListsPricingInit,
  Migration20260504T125655PriceListsEngine,
  Migration20260817T055457PriceListsSingleSystemPriceList,
  Migration20260821T135907PriceListsUnitPriceAmountIndex,
};
