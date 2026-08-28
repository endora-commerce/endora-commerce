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

import { Migration20260611T140355OrdersBusinessId } from './20260611T140355_orders_business_id.js';
import { Migration20260611T140356OrdersStatusModel } from './20260611T140356_orders_status_model.js';
import { Migration20260611T140357OrdersOrderCommentsAndSavedViews } from './20260611T140357_orders_order_comments_and_saved_views.js';
import { Migration20260611T140401OrdersOrderStatusDefaultName } from './20260611T140401_orders_order_status_default_name.js';
import { Migration20260611T140405OrdersOrderStatusColor } from './20260611T140405_orders_order_status_color.js';
import { Migration20260611T140406OrdersOrderSavedViewColumns } from './20260611T140406_orders_order_saved_view_columns.js';
import { Migration20260611T140414OrdersOrderItemPackaging } from './20260611T140414_orders_order_item_packaging.js';
import { Migration20260618T130459OrdersOrderAppliedPromotions } from './20260618T130459_orders_order_applied_promotions.js';
import { Migration20260718T200339OrdersOrderCustomFieldValues } from './20260718T200339_orders_order_custom_field_values.js';
import { Migration20260724T193611OrdersOrderPlacementIntents } from './20260724T193611_orders_order_placement_intents.js';
import { Migration20260820T100201OrdersNewToPaidTransition } from './20260820T100201_orders_new_to_paid_transition.js';
import { Migration20260821T131145OrdersPurchaseConversionMarker } from './20260821T131145_orders_purchase_conversion_marker.js';
import { Migration20260824T080000OrdersDeliveryPointSnapshot } from './20260824T080000_orders_delivery_point_snapshot.js';

export const migrations = [
  Migration20260611T140355OrdersBusinessId,
  Migration20260611T140356OrdersStatusModel,
  Migration20260611T140357OrdersOrderCommentsAndSavedViews,
  Migration20260611T140401OrdersOrderStatusDefaultName,
  Migration20260611T140405OrdersOrderStatusColor,
  Migration20260611T140406OrdersOrderSavedViewColumns,
  Migration20260611T140414OrdersOrderItemPackaging,
  Migration20260618T130459OrdersOrderAppliedPromotions,
  Migration20260718T200339OrdersOrderCustomFieldValues,
  Migration20260724T193611OrdersOrderPlacementIntents,
  Migration20260820T100201OrdersNewToPaidTransition,
  Migration20260821T131145OrdersPurchaseConversionMarker,
  Migration20260824T080000OrdersDeliveryPointSnapshot,
];

export {
  Migration20260611T140355OrdersBusinessId,
  Migration20260611T140356OrdersStatusModel,
  Migration20260611T140357OrdersOrderCommentsAndSavedViews,
  Migration20260611T140401OrdersOrderStatusDefaultName,
  Migration20260611T140405OrdersOrderStatusColor,
  Migration20260611T140406OrdersOrderSavedViewColumns,
  Migration20260611T140414OrdersOrderItemPackaging,
  Migration20260618T130459OrdersOrderAppliedPromotions,
  Migration20260718T200339OrdersOrderCustomFieldValues,
  Migration20260724T193611OrdersOrderPlacementIntents,
  Migration20260820T100201OrdersNewToPaidTransition,
  Migration20260821T131145OrdersPurchaseConversionMarker,
  Migration20260824T080000OrdersDeliveryPointSnapshot,
};
