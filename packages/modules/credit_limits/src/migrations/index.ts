/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent — *"the `./migrations` export of
 * @endora-commerce/mod-credit-limits exports no 'migrations' array"* (D-168).
 *
 * **Four classes, listed in ascending timestamp, which orders this module's own
 * migrations and nothing else** (feature 081). Where this block sits relative
 * to every other module's is decided by the manifest `dependencies` graph:
 * `credit_limits` declares `orders`, and
 * `…T081252_…_credit_limit_reservation_order_fk` is why — it adds
 * `credit_limit_reservations_order_fk` (`credit_limit_reservations.order_id` ->
 * `orders.id`, `on delete restrict`), so `orders`' tables must already exist
 * when this block runs. A foreign key needs the **table**, never the owner's
 * entity class (D-169), which is what lets that constraint stand while
 * `./backend` publishes no entity class by name.
 *
 * The **named** exports stay, and the asymmetry with `./backend` — which
 * publishes an array and no named class (D-168) — is deliberate.
 * `db/migrations-registry.generated.ts` imports each class by name from this
 * specifier and hands it to `migration('credit_limits', …)`, and a migration
 * class name is contract in a way an entity class name is not:
 * `mikro_orm_migrations` persists it, so it is a string every already-migrated
 * database holds.
 *
 * A class that is in neither the array nor the barrel is a migration that does
 * not run: `migration:pending` reports nothing pending and the first symptom is
 * a query against a table nobody created.
 */

import { Migration20260425T063333CreditLimitsInit } from './20260425T063333_credit_limits_init.js';
import { Migration20260817T201111CreditLimitsReturnTopups } from './20260817T201111_credit_limits_return_topups.js';
import { Migration20260818T081252CreditLimitsCreditLimitReservationOrderFk } from './20260818T081252_credit_limits_credit_limit_reservation_order_fk.js';
import { Migration20260821T140323CreditLimitsReservationReservingOrganization } from './20260821T140323_credit_limits_reservation_reserving_organization.js';

export const migrations = [
  Migration20260425T063333CreditLimitsInit,
  Migration20260817T201111CreditLimitsReturnTopups,
  Migration20260818T081252CreditLimitsCreditLimitReservationOrderFk,
  Migration20260821T140323CreditLimitsReservationReservingOrganization,
];

export {
  Migration20260425T063333CreditLimitsInit,
  Migration20260817T201111CreditLimitsReturnTopups,
  Migration20260818T081252CreditLimitsCreditLimitReservationOrderFk,
  Migration20260821T140323CreditLimitsReservationReservingOrganization,
};
