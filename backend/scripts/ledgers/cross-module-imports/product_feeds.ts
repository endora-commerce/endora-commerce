/**
 * Cross-module imports still standing in `product_feeds` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/product_feeds/backend.ts:credentials/services/configuration-type-registry':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/plugin.ts:catalog/entities/product.entity':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/plugin.ts:credentials/services/credentials.service':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/plugin.ts:custom_fields/services/custom-field-definition.service':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/plugin.ts:languages/services/language-service':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/plugin.ts:price_lists/services/pricing-service.interface':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/plugin.ts:taxes/services/tax-service':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/services/delivery/delivery-config.service.ts:credentials/services/credentials.service':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/services/feed-generation.service.ts:catalog/entities/category.entity':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/services/feed-generation.service.ts:catalog/entities/product-variant.entity':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/services/feed-generation.service.ts:catalog/entities/product.entity':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/services/product-feed.service.ts:languages/entities/language.entity':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/services/product-feed.service.ts:price_lists/entities/price-list.entity':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/services/product-selection.service.ts:catalog/entities/product.entity':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/services/taxonomy-mapping.service.ts:catalog/entities/category.entity':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/services/taxonomy-revision.service.ts:catalog/entities/category.entity':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
  'modules/product_feeds/services/template-preview.service.ts:catalog/entities/product.entity':
    'F3 Phase C — product_feeds. Retired by the product_feeds cut merge request.',
};
