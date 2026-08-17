/**
 * Cross-module imports still standing in `price_lists` (feature 075, FR-022…FR-026).
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
  'modules/price_lists/routes.storefront.ts:catalog/entities/product.entity':
    'F3 Phase C — price_lists. Retired by the price_lists cut merge request.',
  'modules/price_lists/routes.ts:catalog/entities/category.entity':
    'F3 Phase C — price_lists. Retired by the price_lists cut merge request.',
  'modules/price_lists/routes.ts:catalog/entities/product.entity':
    'F3 Phase C — price_lists. Retired by the price_lists cut merge request.',
  'modules/price_lists/routes.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — price_lists. Retired by the price_lists cut merge request.',
  'modules/price_lists/routes.ts:organizations/entities/organization.entity':
    'F3 Phase C — price_lists. Retired by the price_lists cut merge request.',
  'modules/price_lists/services/default-price-list-migration.ts:catalog/entities/product.entity':
    'F3 Phase C — price_lists. Retired by the price_lists cut merge request.',
  'modules/price_lists/services/price-list-service.ts:catalog/entities/category.entity':
    'F3 Phase C — price_lists. Retired by the price_lists cut merge request.',
  'modules/price_lists/services/price-list-service.ts:catalog/entities/product.entity':
    'F3 Phase C — price_lists. Retired by the price_lists cut merge request.',
  'modules/price_lists/services/price-list-service.ts:organizations/entities/organization.entity':
    'F3 Phase C — price_lists. Retired by the price_lists cut merge request.',
  'modules/price_lists/services/pricing-service.interface.ts:catalog/entities/product.entity':
    'F3 Phase C — price_lists. Retired by the price_lists cut merge request.',
  'modules/price_lists/services/pricing-service.interface.ts:organizations/entities/organization.entity':
    'F3 Phase C — price_lists. Retired by the price_lists cut merge request.',
  'modules/price_lists/services/pricing-service.ts:catalog/entities/product.entity':
    'F3 Phase C — price_lists. Retired by the price_lists cut merge request.',
  'modules/price_lists/services/pricing-service.ts:organizations/entities/organization.entity':
    'F3 Phase C — price_lists. Retired by the price_lists cut merge request.',
};
