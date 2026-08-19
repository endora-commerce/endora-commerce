/**
 * Cross-module imports still standing in `customers` (feature 075, FR-022…FR-026).
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
  'modules/customers/plugin.ts:admin_users/services/impersonation-service':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/plugin.ts:carts/services/cart-query-service':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/plugin.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/plugin.ts:email/services/mailer':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/plugin.ts:orders/services/order-list-service':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/plugin.ts:quote_requests/services/rfq-service':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/routes.admin.ts:admin_users/services/impersonation-service':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/routes.admin.ts:auth/plugin':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/routes.admin.ts:carts/services/cart-query-service':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/routes.admin.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/routes.admin.ts:email/services/mailer':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/routes.admin.ts:orders/services/order-list-service':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/routes.admin.ts:quote_requests/services/rfq-service':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/routes.register.ts:auth/plugin':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/routes.self.ts:orders/services/order-list-service':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/routes.self.ts:quote_requests/services/rfq-service':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/services/customer-admin-query-service.ts:orders/entities/order.entity':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
  'modules/customers/services/customer-presence-service.ts:auth/entities/session.entity':
    'F3 Phase C — customers. Retired by the customers cut merge request.',
};
