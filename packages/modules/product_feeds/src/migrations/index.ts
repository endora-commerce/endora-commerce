/**
 * The `./migrations` subpath — every migration class this module owns, as one
 * ordered `migrations` array.
 *
 * The array is what the platform reads when this module is **installed**:
 * `src/packages/package-runtime.ts` takes `exported['migrations']` and refuses
 * the package outright when it is absent (D-168).
 *
 * **Seven classes, listed in ascending timestamp, which orders this module's
 * own migrations and nothing else** (feature 081). Where the block sits
 * relative to every other module's is decided by the manifest `dependencies`
 * graph, and packaging changes no manifest, so this move leaves the committed
 * registry's `(moduleId, className)` sequence exactly where it was.
 *
 * The **named** exports stay, and the asymmetry with `./backend` — which
 * publishes an array and no named entity class (D-168) — is deliberate.
 * `db/migrations-registry.generated.ts` imports each class by name from this
 * specifier, and a migration class name is contract in a way an entity class
 * name is not: `mikro_orm_migrations` persists it, so it is a string every
 * already-migrated database holds.
 *
 * A class that is in neither the array nor the barrel is a migration that does
 * not run: `migration:pending` reports nothing pending and the first symptom is
 * a query against a table nobody created.
 */

import { Migration20260802T073547ProductFeedsInit } from './20260802T073547_product_feeds_init.js';
import { Migration20260802T073627ProductFeedsRuns } from './20260802T073627_product_feeds_runs.js';
import { Migration20260802T110630ProductFeedsTaxonomies } from './20260802T110630_product_feeds_taxonomies.js';
import { Migration20260803T060153ProductFeedsTaxonomyRefresh } from './20260803T060153_product_feeds_taxonomy_refresh.js';
import { Migration20260804T152741ProductFeedsWidenIssueSku } from './20260804T152741_product_feeds_widen_issue_sku.js';
import { Migration20260806T105956ProductFeedsFeedTokenSecret } from './20260806T105956_product_feeds_feed_token_secret.js';
import { Migration20260806T125806ProductFeedsDelivery } from './20260806T125806_product_feeds_delivery.js';

export const migrations = [
  Migration20260802T073547ProductFeedsInit,
  Migration20260802T073627ProductFeedsRuns,
  Migration20260802T110630ProductFeedsTaxonomies,
  Migration20260803T060153ProductFeedsTaxonomyRefresh,
  Migration20260804T152741ProductFeedsWidenIssueSku,
  Migration20260806T105956ProductFeedsFeedTokenSecret,
  Migration20260806T125806ProductFeedsDelivery,
];

export {
  Migration20260802T073547ProductFeedsInit,
  Migration20260802T073627ProductFeedsRuns,
  Migration20260802T110630ProductFeedsTaxonomies,
  Migration20260803T060153ProductFeedsTaxonomyRefresh,
  Migration20260804T152741ProductFeedsWidenIssueSku,
  Migration20260806T105956ProductFeedsFeedTokenSecret,
  Migration20260806T125806ProductFeedsDelivery,
};
