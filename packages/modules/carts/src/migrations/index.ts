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

import { Migration20260611T140352CartsConsolidation } from './20260611T140352_carts_consolidation.js';
import { Migration20260611T140413CartsCartItemPackaging } from './20260611T140413_carts_cart_item_packaging.js';
import { Migration20260818T081253CartsCartCompletedOrderFk } from './20260818T081253_carts_cart_completed_order_fk.js';
import { Migration20260830T112911CartsOrganizationAttributionCheck } from './20260830T112911_carts_organization_attribution_check.js';

export const migrations = [
  Migration20260611T140352CartsConsolidation,
  Migration20260611T140413CartsCartItemPackaging,
  Migration20260818T081253CartsCartCompletedOrderFk,
  Migration20260830T112911CartsOrganizationAttributionCheck,
];

export {
  Migration20260611T140352CartsConsolidation,
  Migration20260611T140413CartsCartItemPackaging,
  Migration20260818T081253CartsCartCompletedOrderFk,
  Migration20260830T112911CartsOrganizationAttributionCheck,
};
