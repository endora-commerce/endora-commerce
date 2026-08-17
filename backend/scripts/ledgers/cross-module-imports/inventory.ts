/**
 * Cross-module imports still standing in `inventory` (feature 075, FR-022…FR-026).
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
  'modules/inventory/backend.ts:prompt_actions/services/tool-registry':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/backend.ts:transactional_emails/services/email-defaults-registry':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/plugin.ts:email/services/mailer':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/prompt-tools.ts:catalog/entities/product.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/prompt-tools.ts:prompt_actions/services/tool-registry':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/routes.admin.ts:catalog/entities/product.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/routes.ts:catalog/entities/category.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/routes.ts:catalog/entities/product.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/routes.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/availability-notification-service.ts:catalog/entities/product.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/availability-notification-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/availability-notification-service.ts:email/services/mailer':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/availability-worker.ts:catalog/entities/product.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/availability-worker.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/availability-worker.ts:email/services/mailer':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/csv-stock-importer.ts:catalog/entities/product.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/low-stock-alert-service.ts:catalog/entities/product.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/low-stock-alert-service.ts:email/services/mailer':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/stock-level-service.ts:catalog/entities/category.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/stock-level-service.ts:catalog/entities/product.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/threshold-admin-service.ts:catalog/entities/category.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/threshold-admin-service.ts:catalog/entities/product.entity':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
  'modules/inventory/services/warehouse-service.ts:dictionaries/services/dispatch-validator-mode':
    'F3 Phase C — inventory. Retired by the inventory cut merge request.',
};
