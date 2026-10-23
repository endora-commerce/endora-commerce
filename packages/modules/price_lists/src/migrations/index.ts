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
import { Migration20261016T131148PriceListsPriceMatrixEntries } from './20261016T131148_price_lists_price_matrix_entries.js';
import { Migration20261021T165239PriceListsPriceBooksExpand } from './20261021T165239_price_lists_price_books_expand.js';
import { Migration20261021T232310PriceListsPriceBooksVersion } from './20261021T232310_price_lists_price_books_version.js';
import { Migration20261022T012134PriceListsPriceSurfaceGenerations } from './20261022T012134_price_lists_price_surface_generations.js';
import { Migration20261022T111815PriceListsPriceBooksConversion } from './20261022T111815_price_lists_price_books_conversion.js';
import { Migration20261022T182527PriceListsProductLines } from './20261022T182527_price_lists_product_lines.js';
import { Migration20261023T152351PriceListsPriceSurfaceTargetedMarks } from './20261023T152351_price_lists_price_surface_targeted_marks.js';

export const migrations = [
  Migration20260426T075235PriceListsPricingInit,
  Migration20260504T125655PriceListsEngine,
  Migration20260817T055457PriceListsSingleSystemPriceList,
  Migration20260821T135907PriceListsUnitPriceAmountIndex,
  Migration20261016T131148PriceListsPriceMatrixEntries,
  Migration20261021T165239PriceListsPriceBooksExpand,
  Migration20261021T232310PriceListsPriceBooksVersion,
  Migration20261022T012134PriceListsPriceSurfaceGenerations,
  Migration20261022T111815PriceListsPriceBooksConversion,
  Migration20261022T182527PriceListsProductLines,
  Migration20261023T152351PriceListsPriceSurfaceTargetedMarks,
];

export {
  Migration20260426T075235PriceListsPricingInit,
  Migration20260504T125655PriceListsEngine,
  Migration20260817T055457PriceListsSingleSystemPriceList,
  Migration20260821T135907PriceListsUnitPriceAmountIndex,
  Migration20261016T131148PriceListsPriceMatrixEntries,
  Migration20261021T165239PriceListsPriceBooksExpand,
  Migration20261021T232310PriceListsPriceBooksVersion,
  Migration20261022T012134PriceListsPriceSurfaceGenerations,
  Migration20261022T111815PriceListsPriceBooksConversion,
  Migration20261022T182527PriceListsProductLines,
  Migration20261023T152351PriceListsPriceSurfaceTargetedMarks,
};
