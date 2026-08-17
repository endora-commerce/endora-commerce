/**
 * Cross-module imports still standing in `carts` (feature 075, FR-022…FR-026).
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
  'modules/carts/routes.organization.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/routes.ts:catalog/entities/product.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/routes.ts:organizations/services/organization-context-service':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-admin-service.ts:catalog/entities/product.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-admin-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-admin-service.ts:organizations/entities/organization.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-approval-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-approval-service.ts:organizations/entities/organization.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-conversion-service.ts:catalog/entities/product.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-conversion-service.ts:quote_requests/entities/quote-request-item.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-conversion-service.ts:quote_requests/entities/quote-request.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-conversion-service.ts:quote_requests/services/rfq-service':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-coupon-service.ts:promotions/entities/promotion-coupon.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-coupon-service.ts:promotions/entities/promotion.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-coupon-service.ts:promotions/services/promotion-service':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-organization-visibility-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-pricing-recompute.ts:catalog/entities/product.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-pricing-recompute.ts:organizations/entities/organization.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-pricing-recompute.ts:price_lists/services/pricing-service.interface':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-service.ts:catalog/entities/product-packaging-unit.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-service.ts:catalog/entities/product.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-service.ts:organizations/entities/organization.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-service.ts:price_lists/services/pricing-service.interface':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-upsell-service.ts:catalog/entities/product-link.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
  'modules/carts/services/cart-upsell-service.ts:catalog/entities/product.entity':
    'F3 Phase C — carts. Retired by the carts cut merge request.',
};
