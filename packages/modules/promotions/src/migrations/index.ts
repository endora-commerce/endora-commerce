/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent — *"the `./migrations` export of
 * @endora-commerce/mod-promotions exports no 'migrations' array"* (D-168).
 *
 * **Three classes, listed in ascending timestamp, which orders this module's own
 * migrations and nothing else** (feature 081). Where this block sits relative to
 * every other module's is decided by the manifest `dependencies` graph:
 * `promotions` declares `orders`, and
 * `…T081251_…_promotion_usage_order_fk` is why — it adds
 * `promotion_usages_order_fk` (`promotion_usages.order_id` -> `orders.id`,
 * `on delete restrict`), so `orders`' tables must already exist when this block
 * runs. A foreign key needs the **table**, never the owner's entity class
 * (D-169), which is what lets that constraint stand while `./backend` publishes
 * no entity class by name.
 *
 * The **named** exports stay, and the asymmetry with `./backend` — which
 * publishes an array and no named class (D-168) — is deliberate.
 * `db/migrations-registry.generated.ts` imports each class by name from this
 * specifier and hands it to `migration('promotions', …)`, and a migration class
 * name is contract in a way an entity class name is not:
 * `mikro_orm_migrations` persists it, so it is a string every already-migrated
 * database holds.
 *
 * A class that is in neither the array nor the barrel is a migration that does
 * not run: `migration:pending` reports nothing pending and the first symptom is
 * a query against a table nobody created.
 */

import { Migration20260505T074605PromotionsCriteria } from './20260505T074605_promotions_criteria.js';
import { Migration20260618T100727PromotionsEngine } from './20260618T100727_promotions_engine.js';
import { Migration20260818T081251PromotionsPromotionUsageOrderFk } from './20260818T081251_promotions_promotion_usage_order_fk.js';

export const migrations = [
  Migration20260505T074605PromotionsCriteria,
  Migration20260618T100727PromotionsEngine,
  Migration20260818T081251PromotionsPromotionUsageOrderFk,
];

export {
  Migration20260505T074605PromotionsCriteria,
  Migration20260618T100727PromotionsEngine,
  Migration20260818T081251PromotionsPromotionUsageOrderFk,
};
