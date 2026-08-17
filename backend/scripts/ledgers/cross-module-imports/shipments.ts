/**
 * Cross-module imports still standing in `shipments` (feature 075, FR-022…FR-026).
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
  'modules/shipments/backend.ts:delivery_methods/services/order-status-registry.port':
    'F3 Phase C — shipments. Retired by the shipments cut merge request.',
  'modules/shipments/backend.ts:delivery_methods/services/shipping-adapter-registry':
    'F3 Phase C — shipments. Retired by the shipments cut merge request.',
  'modules/shipments/backend.ts:transactional_emails/services/email-defaults-registry':
    'F3 Phase C — shipments. Retired by the shipments cut merge request.',
  'modules/shipments/services/receive-shipment-handler.ts:delivery_methods/entities/delivery-method.entity':
    'F3 Phase C — shipments. Retired by the shipments cut merge request.',
  'modules/shipments/services/receive-shipment-handler.ts:delivery_methods/services/order-status-registry.port':
    'F3 Phase C — shipments. Retired by the shipments cut merge request.',
  'modules/shipments/services/receive-shipment-handler.ts:orders/entities/order.entity':
    'F3 Phase C — shipments. Retired by the shipments cut merge request.',
  'modules/shipments/services/receive-shipment-handler.ts:orders/events/order-status-events':
    'F3 Phase C — shipments. Retired by the shipments cut merge request.',
  'modules/shipments/services/shipment-email-notifier.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — shipments. Retired by the shipments cut merge request.',
  'modules/shipments/services/shipment-email-notifier.ts:orders/entities/order.entity':
    'F3 Phase C — shipments. Retired by the shipments cut merge request.',
  'modules/shipments/services/shipment-service.ts:delivery_methods/entities/delivery-method.entity':
    'F3 Phase C — shipments. Retired by the shipments cut merge request.',
  'modules/shipments/services/shipment-service.ts:delivery_methods/services/shipping-adapter-registry':
    'F3 Phase C — shipments. Retired by the shipments cut merge request.',
  'modules/shipments/services/shipment-service.ts:orders/entities/order.entity':
    'F3 Phase C — shipments. Retired by the shipments cut merge request.',
};
