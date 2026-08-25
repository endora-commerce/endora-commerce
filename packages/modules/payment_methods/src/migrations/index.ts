/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * **Two classes, listed in ascending timestamp.** The second is stamped after
 * `BASELINE_THROUGH`, so this block is one of the two in the first batch that
 * leaves the frozen historical prefix and is ordered by the manifest
 * `dependencies` graph. A timestamp orders this module's own migrations and
 * nothing else (feature 081).
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

import { Migration20260611T140353PaymentMethodsAdapter } from './20260611T140353_payment_methods_adapter.js';
import { Migration20260821T084920PaymentMethodsFailureStatusOnHold } from './20260821T084920_payment_methods_failure_status_on_hold.js';

export const migrations = [
  Migration20260611T140353PaymentMethodsAdapter,
  Migration20260821T084920PaymentMethodsFailureStatusOnHold,
];

export {
  Migration20260611T140353PaymentMethodsAdapter,
  Migration20260821T084920PaymentMethodsFailureStatusOnHold,
};
