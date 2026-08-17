/**
 * Cross-module imports still standing in `payments` (feature 075, FR-022…FR-026).
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
  'modules/payments/backend.ts:delivery_methods/services/order-status-registry.port':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
  'modules/payments/backend.ts:payment_methods/services/payment-adapter-registry':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
  'modules/payments/backend.ts:transactional_emails/services/email-defaults-registry':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
  'modules/payments/services/gateway-refund-registry.ts:returns/ports/payment-refund.port':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
  'modules/payments/services/payment-email-notifier.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
  'modules/payments/services/payment-email-notifier.ts:orders/entities/order.entity':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
  'modules/payments/services/payment-refund.ts:orders/entities/order.entity':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
  'modules/payments/services/payment-refund.ts:payment_methods/entities/payment-method.entity':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
  'modules/payments/services/payment-refund.ts:returns/ports/payment-refund.port':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
  'modules/payments/services/receive-payment-handler.ts:orders/domain/order-status-graph':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
  'modules/payments/services/receive-payment-handler.ts:orders/entities/order.entity':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
  'modules/payments/services/receive-payment-handler.ts:orders/events/order-status-events':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
  'modules/payments/services/receive-payment-handler.ts:payment_methods/entities/payment-method.entity':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
  'modules/payments/services/receive-payment-handler.ts:payment_methods/services/order-status-registry.port':
    'F3 Phase C — payments. Retired by the payments cut merge request.',
};
