import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { PluralizingNamingStrategy } from './pluralizing-naming-strategy.js';
import { ALL_ENTITIES } from './entities-registry.js';
import { Migration001FoundationInit } from './migrations/001_foundation_init.js';
import { Migration002QuoteRequestsInit } from '../modules/quote_requests/migrations/002_quote_requests_init.js';
import { Migration003OrganizationsInit } from '../modules/organizations/migrations/003_organizations_init.js';
import { Migration004CommerceInit } from './migrations/004_commerce_init.js';
import { Migration005InvitationsInit } from '../modules/organizations/migrations/005_invitations_init.js';
import { Migration006AdminUsersInit } from '../modules/admin_users/migrations/006_admin_users_init.js';
import { Migration007PasswordResetTokens } from '../modules/customer_accounts/migrations/007_password_reset_tokens.js';
import { Migration008CreditLimitsInit } from '../modules/credit_limits/migrations/008_credit_limits_init.js';
import { Migration009Us7Init } from '../modules/webhooks/migrations/009_us7_init.js';
import { Migration010AnalyticsInit } from '../modules/analytics/migrations/010_analytics_init.js';
import { Migration011SeoInit } from '../modules/seo/migrations/011_seo_init.js';
import { Migration012LanguagesCurrenciesInit } from '../modules/languages/migrations/012_languages_currencies_init.js';
import { Migration013CmsPagesInit } from '../modules/cms/migrations/013_cms_pages_init.js';
import { Migration014PricingInit } from '../modules/price_lists/migrations/014_pricing_init.js';
import { Migration015TaxesPromotionsInit } from '../modules/taxes/migrations/015_taxes_promotions_init.js';
import { Migration016ShoppingListsInit } from '../modules/shopping_lists/migrations/016_shopping_lists_init.js';
import { Migration017AttributeSetsInit } from '../modules/catalog/migrations/017_attribute_sets_init.js';
import { Migration018ProductAttributeExtensions } from '../modules/catalog/migrations/018_product_attribute_extensions.js';
import { Migration019ProductTypeAndVirtualFields } from '../modules/catalog/migrations/019_product_type_and_virtual_fields.js';
import { Migration020GalleryItemsAndLabels } from '../modules/catalog/migrations/020_gallery_items_and_labels.js';
import { Migration021ProductAttachments } from '../modules/catalog/migrations/021_product_attachments.js';
import { Migration022ProductLinks } from '../modules/catalog/migrations/022_product_links.js';
import { Migration023GroupedAndBundle } from '../modules/catalog/migrations/023_grouped_and_bundle.js';
import { Migration024SettingsInit } from '../modules/settings/migrations/024_settings_init.js';
import { Migration025SalesChannelsPromote } from '../modules/sales_channels/migrations/025_sales_channels_promote.js';
import { Migration026SearchPhraseRecordsInit } from '../modules/search/migrations/026_search_phrase_records_init.js';
import { Migration027ComparisonsInit } from '../modules/comparisons/migrations/027_comparisons_init.js';
import { Migration028ProductAttributeIsComparable } from '../modules/catalog/migrations/028_product_attribute_is_comparable.js';
import { Migration029QuoteRequestsWorkflow } from '../modules/quote_requests/migrations/029_quote_requests_workflow.js';
import { Migration030InventoryWorkflow } from '../modules/inventory/migrations/030_inventory_workflow.js';
import { Migration031PriceListsEngine } from '../modules/price_lists/migrations/031_price_lists_engine.js';
import { Migration032AttributeOptionsAndFlags } from '../modules/catalog/migrations/032_attribute_options_and_flags.js';
import { Migration033PromotionsCriteria } from '../modules/promotions/migrations/033_promotions_criteria.js';
import { Migration034AssetsLibraryInit } from '../modules/assets_library/migrations/034_assets_library_init.js';
import { Migration035CmsInit } from '../modules/cms/migrations/035_cms_init.js';
import { Migration036MegamenuInit } from '../modules/megamenu/migrations/036_megamenu_init.js';
import { Migration037BlogInit } from '../modules/blog/migrations/037_blog_init.js';
import { Migration038DictionaryInit } from '../modules/dictionaries/migrations/038_dictionary_init.js';
import { Migration039ModuleLifecycleInit } from './migrations/039_module_lifecycle_init.js';
import { Migration040AdminI18nInit } from '../modules/_i18n/migrations/040_admin_i18n_init.js';
import { Migration041AdminActionsInit } from '../modules/admin_actions/migrations/041_admin_actions_init.js';
import { Migration042SettingsGlobalValue } from '../modules/settings/migrations/042_settings_global_value.js';
import { Migration043AttributeMassEditable } from '../modules/catalog/migrations/043_attribute_mass_editable.js';
import { Migration044ProductStatusInactive } from '../modules/catalog/migrations/044_product_status_inactive.js';
import { Migration044ProductValueOverridesInit } from '../modules/catalog/migrations/044_product_value_overrides_init.js';
import { Migration045WarehouseDefaultLowStockThreshold } from '../modules/inventory/migrations/045_warehouse_default_low_stock_threshold.js';
import { Migration046PerWarehouseLowStockThresholds } from '../modules/inventory/migrations/046_per_warehouse_low_stock_thresholds.js';
import { Migration047OrganizationsConsolidation } from '../modules/organizations/migrations/047_organizations_consolidation.js';
import { Migration048AdminNotificationsInit } from '../modules/admin_notifications/migrations/048_admin_notifications_init.js';
import { Migration049CustomerAccountsOrganizationOptional } from '../modules/customer_accounts/migrations/049_customer_accounts_organization_optional.js';
import { Migration050CartsConsolidation } from '../modules/carts/migrations/050_carts_consolidation.js';
import { Migration051PaymentMethodsAdapter } from '../modules/payment_methods/migrations/051_payment_methods_adapter.js';
import { Migration052ShippingMethodsAdapterAndShipments } from '../modules/delivery_methods/migrations/052_shipping_methods_adapter_and_shipments.js';
import { Migration053OrdersBusinessId } from '../modules/orders/migrations/053_orders_business_id.js';
import { Migration054OrdersStatusModel } from '../modules/orders/migrations/054_orders_status_model.js';
import { Migration055OrderCommentsAndSavedViews } from '../modules/orders/migrations/055_order_comments_and_saved_views.js';
import { Migration056OrgOrderConfirmationEmails } from '../modules/organizations/migrations/056_org_order_confirmation_emails.js';
import { Migration057QuickOrderDefaultPreferences } from '../modules/quick_order/migrations/057_quick_order_default_preferences.js';
import { Migration058AttributeQuickSearchable } from '../modules/catalog/migrations/058_attribute_quick_searchable.js';
import { Migration059OrderStatusDefaultName } from '../modules/orders/migrations/059_order_status_default_name.js';
import { Migration060OrgFulfilmentStrategy } from '../modules/organizations/migrations/060_org_fulfilment_strategy.js';
import { Migration061CustomerAccountsLifecycle } from '../modules/customer_accounts/migrations/061_customer_accounts_lifecycle.js';
import { Migration062CustomerAddressesInit } from '../modules/customers/migrations/062_customer_addresses_init.js';
import { Migration063OrderStatusColor } from '../modules/orders/migrations/063_order_status_color.js';
import { Migration064OrderSavedViewColumns } from '../modules/orders/migrations/064_order_saved_view_columns.js';
import { Migration065CatalogBulkOperations } from '../modules/catalog/migrations/065_catalog_bulk_operations.js';
import { Migration066BulkOperationLogs } from '../modules/catalog/migrations/066_bulk_operation_logs.js';
import { Migration067MfaInit } from '../modules/mfa/migrations/067_mfa_init.js';
import { Migration068PromptActionsInit } from '../modules/prompt_actions/migrations/068_prompt_actions_init.js';
import { Migration069SettingsSecretValueType } from '../modules/settings/migrations/069_settings_secret_value_type.js';
import { Migration068ProductPackagingUnits } from '../modules/catalog/migrations/068_product_packaging_units.js';
import { Migration069CartItemPackaging } from '../modules/carts/migrations/069_cart_item_packaging.js';
import { Migration070OrderItemPackaging } from '../modules/orders/migrations/070_order_item_packaging.js';
import { Migration071QrItemPackaging } from '../modules/quote_requests/migrations/071_qr_item_packaging.js';
import { Migration074ShoppingListsDefault } from '../modules/shopping_lists/migrations/074_shopping_lists_default.js';
import { Migration072FixInPersonPickupAdapter } from '../modules/delivery_methods/migrations/072_fix_in_person_pickup_adapter.js';
import { Migration073QuoteRequestsBusinessId } from '../modules/quote_requests/migrations/073_quote_requests_business_id.js';
import { Migration075SettingsEnumOptions } from '../modules/settings/migrations/075_settings_enum_options.js';
import { Migration076BackfillAdminCreatedAwaiting } from '../modules/quote_requests/migrations/076_backfill_admin_created_awaiting.js';
import { Migration077PromotionsEngine } from '../modules/promotions/migrations/077_promotions_engine.js';
import { Migration079OrderAppliedPromotions } from '../modules/orders/migrations/079_order_applied_promotions.js';
import { Migration080ReturnsInit } from '../modules/returns/migrations/080_returns_init.js';
import { Migration080PwaInit } from '../modules/pwa/migrations/080_pwa_init.js';
import { Migration081SettingsHiddenFlag } from '../modules/settings/migrations/081_settings_hidden_flag.js';
import { Migration082TransactionalEmailsInit } from '../modules/transactional_emails/migrations/082_transactional_emails_init.js';
import { Migration083InvoicesModule } from '../modules/invoices/migrations/083_invoices_module.js';
import { Migration084NewsletterInit } from '../modules/newsletter/migrations/084_newsletter_init.js';
import { Migration085StripeInit } from '../modules/stripe/migrations/085_stripe_init.js';
import { Migration086PaymentRefundedAmount } from '../modules/stripe/migrations/086_payment_refunded_amount.js';
import { Migration087GoogleAnalyticsInit } from '../modules/google_analytics/migrations/087_google_analytics_init.js';
import { Migration088TenantScopeIndexes } from './migrations/088_tenant_scope_indexes.js';
import { Migration089PersonalOrganizations } from '../modules/organizations/migrations/089_personal_organizations.js';
import { Migration090BulkOperationRevertState } from '../modules/catalog/migrations/090_bulk_operation_revert_state.js';
// Feature 055 — Custom Fields Layer (init + additive host value columns).
import { Migration091CustomFieldsInit } from '../modules/custom_fields/migrations/091_custom_fields_init.js';
import { Migration092OrderCustomFieldValues } from '../modules/orders/migrations/092_order_custom_field_values.js';
import { Migration093OrganizationCustomFieldValues } from '../modules/organizations/migrations/093_organization_custom_field_values.js';
import { Migration094CustomerAccountCustomFieldValues } from '../modules/customer_accounts/migrations/094_customer_account_custom_field_values.js';
import { Migration095QuoteRequestCustomFieldValues } from '../modules/quote_requests/migrations/095_quote_request_custom_field_values.js';
import { Migration096CategoryCustomFieldValues } from '../modules/catalog/migrations/096_category_custom_field_values.js';
import { Migration097OrgHierarchy } from '../modules/organizations/migrations/097_org_hierarchy.js';
import { Migration098CustomerSubtreeRollup } from '../modules/customer_accounts/migrations/098_customer_subtree_rollup.js';
import { Migration099CredentialsInit } from '../modules/credentials/migrations/099_credentials_init.js';
import { Migration100SettingsCredentialRefValueType } from '../modules/settings/migrations/100_settings_credential_ref_value_type.js';

/**
 * MikroORM configuration for the B2B platform backend.
 *
 * - PostgreSQL driver (constitutional stack).
 * - Plural snake_case table names + snake_case columns (Principle VI) via the
 *   custom naming strategy in ./pluralizing-naming-strategy.ts (R-04).
 * - Migration ownership is module-local: each module keeps its migration files
 *   under src/modules/<module>/migrations/. Only the few genuinely cross-cutting
 *   bootstrap migrations (foundation/commerce init, module-lifecycle) live in
 *   src/db/migrations/. Adding a migration means dropping a file in the owning
 *   module's migrations/ dir and adding one import + `migrationsList` entry here.
 * - The `migrationsList` below stays an explicit list rather than a filesystem
 *   glob: glob discovery needs runtime dynamic `import()` of .ts files, which
 *   Node's ESM loader cannot transform and which breaks under Vitest (same
 *   reason entities are listed in src/db/entities-registry.ts). The
 *   "registered ⇔ on-disk" round-trip is enforced by
 *   test/unit/db/migrations-registry.test.ts, which scans every module's
 *   migrations/ dir, so a file that is moved/added without a registry entry
 *   fails CI instead of silently disappearing from the migrator.
 */

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://b2b:b2b@localhost:5432/b2b';

export default defineConfig({
  clientUrl: databaseUrl,
  namingStrategy: PluralizingNamingStrategy,
  // Explicit class list, not a glob — glob discovery requires runtime dynamic
  // `import()` of .ts files, which Node's ESM loader cannot transform and which
  // breaks under Vitest. See src/db/entities-registry.ts for the rationale.
  entities: [...ALL_ENTITIES],
  debug: process.env['NODE_ENV'] === 'development' && process.env['DB_DEBUG'] === 'true',
  allowGlobalContext: false,
  forceUndefined: true,
  extensions: [Migrator],
  migrations: {
    // Explicit migration list — same reasoning as entities above.
    migrationsList: [
      { name: 'Migration001FoundationInit', class: Migration001FoundationInit },
      { name: 'Migration002QuoteRequestsInit', class: Migration002QuoteRequestsInit },
      { name: 'Migration003OrganizationsInit', class: Migration003OrganizationsInit },
      { name: 'Migration004CommerceInit', class: Migration004CommerceInit },
      { name: 'Migration005InvitationsInit', class: Migration005InvitationsInit },
      { name: 'Migration006AdminUsersInit', class: Migration006AdminUsersInit },
      { name: 'Migration007PasswordResetTokens', class: Migration007PasswordResetTokens },
      { name: 'Migration008CreditLimitsInit', class: Migration008CreditLimitsInit },
      { name: 'Migration009Us7Init', class: Migration009Us7Init },
      { name: 'Migration010AnalyticsInit', class: Migration010AnalyticsInit },
      { name: 'Migration011SeoInit', class: Migration011SeoInit },
      { name: 'Migration012LanguagesCurrenciesInit', class: Migration012LanguagesCurrenciesInit },
      { name: 'Migration013CmsPagesInit', class: Migration013CmsPagesInit },
      { name: 'Migration014PricingInit', class: Migration014PricingInit },
      { name: 'Migration015TaxesPromotionsInit', class: Migration015TaxesPromotionsInit },
      { name: 'Migration016ShoppingListsInit', class: Migration016ShoppingListsInit },
      { name: 'Migration017AttributeSetsInit', class: Migration017AttributeSetsInit },
      {
        name: 'Migration018ProductAttributeExtensions',
        class: Migration018ProductAttributeExtensions,
      },
      {
        name: 'Migration019ProductTypeAndVirtualFields',
        class: Migration019ProductTypeAndVirtualFields,
      },
      {
        name: 'Migration020GalleryItemsAndLabels',
        class: Migration020GalleryItemsAndLabels,
      },
      {
        name: 'Migration021ProductAttachments',
        class: Migration021ProductAttachments,
      },
      {
        name: 'Migration022ProductLinks',
        class: Migration022ProductLinks,
      },
      {
        name: 'Migration023GroupedAndBundle',
        class: Migration023GroupedAndBundle,
      },
      {
        name: 'Migration024SettingsInit',
        class: Migration024SettingsInit,
      },
      {
        name: 'Migration025SalesChannelsPromote',
        class: Migration025SalesChannelsPromote,
      },
      {
        name: 'Migration026SearchPhraseRecordsInit',
        class: Migration026SearchPhraseRecordsInit,
      },
      {
        name: 'Migration027ComparisonsInit',
        class: Migration027ComparisonsInit,
      },
      {
        name: 'Migration028ProductAttributeIsComparable',
        class: Migration028ProductAttributeIsComparable,
      },
      {
        name: 'Migration029QuoteRequestsWorkflow',
        class: Migration029QuoteRequestsWorkflow,
      },
      {
        name: 'Migration030InventoryWorkflow',
        class: Migration030InventoryWorkflow,
      },
      {
        name: 'Migration031PriceListsEngine',
        class: Migration031PriceListsEngine,
      },
      {
        name: 'Migration032AttributeOptionsAndFlags',
        class: Migration032AttributeOptionsAndFlags,
      },
      {
        name: 'Migration033PromotionsCriteria',
        class: Migration033PromotionsCriteria,
      },
      {
        name: 'Migration034AssetsLibraryInit',
        class: Migration034AssetsLibraryInit,
      },
      {
        name: 'Migration035CmsInit',
        class: Migration035CmsInit,
      },
      {
        name: 'Migration036MegamenuInit',
        class: Migration036MegamenuInit,
      },
      {
        name: 'Migration037BlogInit',
        class: Migration037BlogInit,
      },
      {
        name: 'Migration038DictionaryInit',
        class: Migration038DictionaryInit,
      },
      {
        name: 'Migration039ModuleLifecycleInit',
        class: Migration039ModuleLifecycleInit,
      },
      {
        name: 'Migration040AdminI18nInit',
        class: Migration040AdminI18nInit,
      },
      {
        name: 'Migration041AdminActionsInit',
        class: Migration041AdminActionsInit,
      },
      {
        name: 'Migration042SettingsGlobalValue',
        class: Migration042SettingsGlobalValue,
      },
      {
        name: 'Migration043AttributeMassEditable',
        class: Migration043AttributeMassEditable,
      },
      {
        name: 'Migration044ProductStatusInactive',
        class: Migration044ProductStatusInactive,
      },
      {
        name: 'Migration044ProductValueOverridesInit',
        class: Migration044ProductValueOverridesInit,
      },
      {
        name: 'Migration045WarehouseDefaultLowStockThreshold',
        class: Migration045WarehouseDefaultLowStockThreshold,
      },
      {
        name: 'Migration046PerWarehouseLowStockThresholds',
        class: Migration046PerWarehouseLowStockThresholds,
      },
      {
        name: 'Migration047OrganizationsConsolidation',
        class: Migration047OrganizationsConsolidation,
      },
      {
        name: 'Migration048AdminNotificationsInit',
        class: Migration048AdminNotificationsInit,
      },
      {
        name: 'Migration049CustomerAccountsOrganizationOptional',
        class: Migration049CustomerAccountsOrganizationOptional,
      },
      {
        name: 'Migration050CartsConsolidation',
        class: Migration050CartsConsolidation,
      },
      {
        name: 'Migration051PaymentMethodsAdapter',
        class: Migration051PaymentMethodsAdapter,
      },
      {
        name: 'Migration052ShippingMethodsAdapterAndShipments',
        class: Migration052ShippingMethodsAdapterAndShipments,
      },
      {
        name: 'Migration053OrdersBusinessId',
        class: Migration053OrdersBusinessId,
      },
      {
        name: 'Migration054OrdersStatusModel',
        class: Migration054OrdersStatusModel,
      },
      {
        name: 'Migration055OrderCommentsAndSavedViews',
        class: Migration055OrderCommentsAndSavedViews,
      },
      {
        name: 'Migration056OrgOrderConfirmationEmails',
        class: Migration056OrgOrderConfirmationEmails,
      },
      {
        name: 'Migration057QuickOrderDefaultPreferences',
        class: Migration057QuickOrderDefaultPreferences,
      },
      {
        name: 'Migration058AttributeQuickSearchable',
        class: Migration058AttributeQuickSearchable,
      },
      {
        name: 'Migration059OrderStatusDefaultName',
        class: Migration059OrderStatusDefaultName,
      },
      {
        name: 'Migration060OrgFulfilmentStrategy',
        class: Migration060OrgFulfilmentStrategy,
      },
      {
        name: 'Migration061CustomerAccountsLifecycle',
        class: Migration061CustomerAccountsLifecycle,
      },
      {
        name: 'Migration062CustomerAddressesInit',
        class: Migration062CustomerAddressesInit,
      },
      {
        name: 'Migration063OrderStatusColor',
        class: Migration063OrderStatusColor,
      },
      {
        name: 'Migration064OrderSavedViewColumns',
        class: Migration064OrderSavedViewColumns,
      },
      {
        name: 'Migration065CatalogBulkOperations',
        class: Migration065CatalogBulkOperations,
      },
      {
        name: 'Migration066BulkOperationLogs',
        class: Migration066BulkOperationLogs,
      },
      {
        name: 'Migration067MfaInit',
        class: Migration067MfaInit,
      },
      {
        name: 'Migration068PromptActionsInit',
        class: Migration068PromptActionsInit,
      },
      {
        name: 'Migration069SettingsSecretValueType',
        class: Migration069SettingsSecretValueType,
      },
      {
        name: 'Migration068ProductPackagingUnits',
        class: Migration068ProductPackagingUnits,
      },
      {
        name: 'Migration069CartItemPackaging',
        class: Migration069CartItemPackaging,
      },
      {
        name: 'Migration070OrderItemPackaging',
        class: Migration070OrderItemPackaging,
      },
      {
        name: 'Migration071QrItemPackaging',
        class: Migration071QrItemPackaging,
      },
      {
        name: 'Migration072FixInPersonPickupAdapter',
        class: Migration072FixInPersonPickupAdapter,
      },
      {
        name: 'Migration073QuoteRequestsBusinessId',
        class: Migration073QuoteRequestsBusinessId,
      },
      {
        name: 'Migration074ShoppingListsDefault',
        class: Migration074ShoppingListsDefault,
      },
      {
        name: 'Migration075SettingsEnumOptions',
        class: Migration075SettingsEnumOptions,
      },
      {
        name: 'Migration076BackfillAdminCreatedAwaiting',
        class: Migration076BackfillAdminCreatedAwaiting,
      },
      {
        name: 'Migration077PromotionsEngine',
        class: Migration077PromotionsEngine,
      },
      {
        name: 'Migration079OrderAppliedPromotions',
        class: Migration079OrderAppliedPromotions,
      },
      {
        name: 'Migration080ReturnsInit',
        class: Migration080ReturnsInit,
      },
      {
        name: 'Migration080PwaInit',
        class: Migration080PwaInit,
      },
      {
        name: 'Migration081SettingsHiddenFlag',
        class: Migration081SettingsHiddenFlag,
      },
      {
        name: 'Migration082TransactionalEmailsInit',
        class: Migration082TransactionalEmailsInit,
      },
      {
        name: 'Migration083InvoicesModule',
        class: Migration083InvoicesModule,
      },
      {
        name: 'Migration084NewsletterInit',
        class: Migration084NewsletterInit,
      },
      {
        name: 'Migration085StripeInit',
        class: Migration085StripeInit,
      },
      {
        name: 'Migration086PaymentRefundedAmount',
        class: Migration086PaymentRefundedAmount,
      },
      {
        name: 'Migration087GoogleAnalyticsInit',
        class: Migration087GoogleAnalyticsInit,
      },
      {
        name: 'Migration088TenantScopeIndexes',
        class: Migration088TenantScopeIndexes,
      },
      {
        name: 'Migration089PersonalOrganizations',
        class: Migration089PersonalOrganizations,
      },
      {
        name: 'Migration090BulkOperationRevertState',
        class: Migration090BulkOperationRevertState,
      },
      {
        name: 'Migration091CustomFieldsInit',
        class: Migration091CustomFieldsInit,
      },
      {
        name: 'Migration092OrderCustomFieldValues',
        class: Migration092OrderCustomFieldValues,
      },
      {
        name: 'Migration093OrganizationCustomFieldValues',
        class: Migration093OrganizationCustomFieldValues,
      },
      {
        name: 'Migration094CustomerAccountCustomFieldValues',
        class: Migration094CustomerAccountCustomFieldValues,
      },
      {
        name: 'Migration095QuoteRequestCustomFieldValues',
        class: Migration095QuoteRequestCustomFieldValues,
      },
      {
        name: 'Migration096CategoryCustomFieldValues',
        class: Migration096CategoryCustomFieldValues,
      },
      {
        name: 'Migration097OrgHierarchy',
        class: Migration097OrgHierarchy,
      },
      {
        name: 'Migration098CustomerSubtreeRollup',
        class: Migration098CustomerSubtreeRollup,
      },
      {
        name: 'Migration099CredentialsInit',
        class: Migration099CredentialsInit,
      },
      {
        name: 'Migration100SettingsCredentialRefValueType',
        class: Migration100SettingsCredentialRefValueType,
      },
    ],
    transactional: true,
    disableForeignKeys: false,
    allOrNothing: true,
    emit: 'ts',
    snapshot: false,
  },
});
