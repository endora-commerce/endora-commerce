/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * **Two classes, listed in ascending timestamp, and both stamped after
 * `BASELINE_THROUGH`** — so they are ordered by the manifest `dependencies`
 * graph rather than by the frozen historical prefix, and this is one of the two
 * modules in the first batch where that path actually runs. A timestamp orders
 * this module's own migrations and nothing else (feature 081):
 * `…T194652_shipments_order_fk` adds `shipments.order_id -> orders.id`, and what
 * puts this block after `orders`' is `shipments`' manifest `dependencies`, never
 * the stamp. A foreign key needs the **table**, never the owner's entity class
 * (D-169), which is what lets that constraint stand while `./backend` publishes
 * no entity class by name.
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

import { Migration20260817T194652ShipmentsOrderFk } from './20260817T194652_shipments_order_fk.js';
import { Migration20260819T171006ShipmentsStatusPendingManual } from './20260819T171006_shipments_status_pending_manual.js';

export const migrations = [
  Migration20260817T194652ShipmentsOrderFk,
  Migration20260819T171006ShipmentsStatusPendingManual,
];

export {
  Migration20260817T194652ShipmentsOrderFk,
  Migration20260819T171006ShipmentsStatusPendingManual,
};
