/**
 * Cross-module imports still standing in `catalog` (feature 075, FR-022…FR-026).
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
  'modules/catalog/backend.ts:assets_library/services/reference-registry':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/backend.ts:prompt_actions/services/tool-registry':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/commands/attribute-commands.ts:custom_fields/services/custom-field-definition.service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/commands/attribute-commands.ts:custom_fields/services/custom-field-definitions-cache':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/plugin.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/plugin.ts:email/services/mailer':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/plugin.ts:languages/services/language-service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/plugin.ts:price_lists/services/pricing-service.interface':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/plugin.ts:search/services/search-query.service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/prompt-tools.ts:prompt_actions/entities/prompt-action-request.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/prompt-tools.ts:prompt_actions/services/tool-registry':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/routes.public.ts:search/services/search-query.service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/attribute-fixtures.ts:custom_fields/entities/custom-field-definition.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/attribute-fixtures.ts:custom_fields/entities/custom-field-option.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:admin_roles/entities/admin-role.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:admin_users/entities/admin-user.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:auth/services/password-hasher':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:delivery_methods/entities/delivery-method.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:inventory/entities/stock-level.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:inventory/entities/warehouse-channel-assignment.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:inventory/entities/warehouse.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:inventory/services/warehouse-channel-reconciler':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:megamenu/entities/megamenu-binding.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:megamenu/entities/megamenu-item.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:megamenu/entities/megamenu.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:organizations/entities/organization.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:payment_methods/entities/payment-method.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:price_lists/services/default-price-list-migration':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/seeds/dev-catalog-seed.ts:taxes/entities/tax.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/asset-references.ts:assets_library/services/reference-registry':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/attachment.service.ts:assets_library/entities/asset.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/bulk-operation.service.ts:admin_users/entities/admin-user.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/bulk-operation.service.ts:email/services/mailer':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-admin.service.ts:custom_fields/services/custom-field-definition.service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-admin.service.ts:custom_fields/services/custom-field-definitions-cache':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-attribute-read.service.ts:custom_fields/services/custom-field-definitions-cache':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-attribute-read.service.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-org-price-decorator.ts:organizations/entities/organization.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-org-price-decorator.ts:price_lists/services/pricing-service.interface':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-query.service.ts:assets_library/entities/asset.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/catalog-query.service.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/category-admin.service.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/gallery.service.ts:assets_library/entities/asset.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/product-link.service.ts:assets_library/entities/asset.entity':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/product-scope-context.service.ts:languages/services/language-service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
  'modules/catalog/services/product-value-resolver.service.ts:languages/services/language-service':
    'F3 Phase C — catalog. Retired by the catalog cut merge request.',
};
