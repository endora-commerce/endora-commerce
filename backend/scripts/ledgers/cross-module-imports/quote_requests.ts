/**
 * Cross-module imports still standing in `quote_requests` (feature 075, FR-022…FR-026).
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
  'modules/quote_requests/plugin.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/plugin.ts:organizations/routes.sales-reps':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/plugin.ts:organizations/services/sales-rep-assignment-service':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/routes.customer.ts:organizations/services/organization-context-service':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/order-completion-reactor.ts:orders/entities/order.entity':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-admin-service.ts:catalog/entities/product.entity':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-admin-service.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-admin-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-admin-service.ts:organizations/entities/organization.entity':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-admin-service.ts:organizations/services/sales-rep-assignment-service':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-expiry-worker.ts:admin_users/entities/admin-user.entity':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-expiry-worker.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-expiry-worker.ts:organizations/services/sales-rep-assignment-service':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-service.ts:admin_users/entities/admin-user.entity':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-service.ts:carts/entities/cart-item.entity':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-service.ts:carts/entities/cart.entity':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-service.ts:catalog/entities/product.entity':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-service.ts:organizations/entities/organization-sales-rep-assignment.entity':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
  'modules/quote_requests/services/rfq-service.ts:organizations/services/sales-rep-assignment-service':
    'F3 Phase C — quote_requests. Retired by the quote_requests cut merge request.',
};
