/**
 * Cross-module imports still standing in `orders` (feature 075, FR-022…FR-026).
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
  'modules/orders/backend.ts:organizations/services/organization-restriction-service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/backend.ts:transactional_emails/services/email-defaults-registry':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/email-templates/admin-created-order.ts:email/services/mailer':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/email-templates/order-comment-notification.ts:email/services/mailer':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/email-templates/order-confirmation.ts:email/services/mailer':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/email-templates/order-confirmation.ts:payments/services/payment-email-renderer':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/email-templates/order-confirmation.ts:shipments/services/shipping-email-renderer':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/email-templates/reorder-created.ts:email/services/mailer':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/plugin.ts:addresses/services/address-service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/plugin.ts:carts/services/cart-service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/plugin.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/plugin.ts:delivery_methods/services/shipping-adapter-registry':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/plugin.ts:email/services/mailer':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/plugin.ts:organizations/entities/organization.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/plugin.ts:payment_methods/services/order-status-registry.port':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/plugin.ts:payment_methods/services/payment-adapter-registry':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/plugin.ts:price_lists/services/pricing-service.interface':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/plugin.ts:promotions/services/promotion-service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/plugin.ts:quote_requests/services/rfq-service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/prompt-tools.test.ts:prompt_actions/services/tool-registry':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/routes.external.ts:organizations/services/organization-context-service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/routes.ts:assets_library/entities/asset.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/routes.ts:catalog/entities/product.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/routes.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/routes.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/routes.ts:delivery_methods/entities/delivery-method.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/routes.ts:invoices/entities/invoice.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/routes.ts:invoices/services/invoice-pdf':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/routes.ts:organizations/entities/organization.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/routes.ts:organizations/services/organization-context-service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/routes.ts:payment_methods/entities/payment-method.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/routes.ts:price_lists/services/pricing-service.interface':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-access-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-api-intake-service.ts:addresses/services/address-service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-api-intake-service.ts:carts/services/cart-service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-api-intake-service.ts:catalog/entities/product.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-api-intake-service.ts:organizations/entities/organization.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-api-intake-service.ts:price_lists/services/pricing-service.interface':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-clone-to-quote-service.ts:quote_requests/services/rfq-service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-comment-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-comment-service.ts:email/services/mailer':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-creation-admin-service.ts:addresses/services/address-service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-creation-admin-service.ts:carts/services/cart-service':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-creation-admin-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-creation-admin-service.ts:email/services/mailer':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-list-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-list-service.ts:organizations/entities/organization.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-list-service.ts:organizations/services/normalize-name':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-reorder-service.ts:carts/entities/cart-item.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-reorder-service.ts:carts/entities/cart.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-reorder-service.ts:catalog/entities/product.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-reorder-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-reorder-service.ts:email/services/mailer':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-return-context.ts:returns/ports/order-return-context.port':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:addresses/entities/address.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:carts/entities/cart-item.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:carts/entities/cart.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:catalog/entities/product.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:delivery_methods/entities/delivery-method.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:delivery_methods/services/shipping-adapter-registry':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:email/services/mailer':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:inventory/entities/stock-allocation.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:inventory/entities/stock-level.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:inventory/entities/warehouse.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:inventory/services/effective-fulfilment-strategy':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:inventory/services/fulfilment-strategy-resolver':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:invoices/entities/invoice.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:organizations/entities/organization.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:payment_methods/entities/payment-method.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:payment_methods/services/order-status-registry.port':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:payment_methods/services/payment-adapter-registry':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
  'modules/orders/services/order-service.ts:payments/entities/payment.entity':
    'F3 Phase C — orders. Retired by the orders cut merge request.',
};
