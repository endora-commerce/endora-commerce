/**
 * Cross-module imports still standing in `quick_order` (feature 075, FR-022…FR-026).
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
  'modules/quick_order/backend.ts:carts/services/cart-service':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/backend.ts:catalog/services/catalog-attribute-read.service':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/backend.ts:orders/services/order-service':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/backend.ts:organizations/services/organization-restriction-service':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/backend.ts:quote_requests/services/rfq-service':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/routes.preferences.admin.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/routes.preferences.admin.ts:organizations/entities/organization-sales-rep-assignment.entity':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/routes.preferences.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/routes.ts:catalog/entities/product.entity':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/routes.ts:catalog/services/catalog-attribute-read.service':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/catalog-lookup.ts:catalog/entities/product-variant.entity':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/catalog-lookup.ts:catalog/entities/product.entity':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/default-preference-service.ts:addresses/entities/address.entity':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/default-preference-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/default-preference-service.ts:customers/entities/customer-address.entity':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/default-preference-service.ts:delivery_methods/entities/delivery-method.entity':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/default-preference-service.ts:organizations/services/organization-restriction-service':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/default-preference-service.ts:payment_methods/entities/payment-method.entity':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/one-click-service.test.ts:carts/services/cart-service':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/one-click-service.test.ts:orders/entities/order.entity':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/one-click-service.test.ts:orders/services/order-service':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/one-click-service.ts:carts/services/cart-service':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/one-click-service.ts:orders/entities/order.entity':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/one-click-service.ts:orders/services/order-service':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/quick-order-build-service.ts:carts/services/cart-service':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
  'modules/quick_order/services/quick-order-build-service.ts:quote_requests/services/rfq-service':
    'F3 Phase C — quick_order. Retired by the quick_order cut merge request.',
};
