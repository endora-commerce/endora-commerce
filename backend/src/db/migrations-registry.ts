/**
 * The single registration point for every migration in the repository.
 *
 * Static imports only — no glob, no dynamic `import()`: Node's ESM loader
 * cannot transform `.ts` at runtime and it breaks under Vitest (the same reason
 * ./entities-registry.ts exists). A migration that is not registered here does
 * not run; the round-trip guard in test/unit/db/migrations-registry.test.ts
 * fails the build for it.
 *
 * Imports and entries are grouped by owning module id, alphabetically, and
 * chronologically inside each group, so two branches adding a migration in
 * different modules edit different regions of this file and never conflict.
 *
 * Declaration order has **no** effect on execution order — that is computed by
 * orderMigrations() from the timestamps and the module dependency graph. Never
 * "fix" an ordering surprise by moving a line here; bump the timestamp or fix
 * the manifest `dependencies`.
 *
 * Naming and registration rules:
 * specs/065-manifest-aware-migrations/contracts/naming-convention.md.
 * Add one with: pnpm --filter backend run migration:new -- --module <id> --name <slug>
 */

import type { MigrationClass, MigrationRegistryEntry } from './migration-order.js';

// ── _i18n ─────────────────────────────────────────────────────────────────
import { Migration20260507T091405I18nAdminI18nInit } from '../modules/_i18n/migrations/20260507T091405_i18n_admin_i18n_init.js';

// ── admin_actions ─────────────────────────────────────────────────────────
import { Migration20260507T142354AdminActionsInit } from '../modules/admin_actions/migrations/20260507T142354_admin_actions_init.js';

// ── admin_notifications ───────────────────────────────────────────────────
import { Migration20260611T140350AdminNotificationsInit } from '../modules/admin_notifications/migrations/20260611T140350_admin_notifications_init.js';

// ── admin_users ───────────────────────────────────────────────────────────
import { Migration20260425T053028AdminUsersInit } from '../modules/admin_users/migrations/20260425T053028_admin_users_init.js';

// ── analytics ─────────────────────────────────────────────────────────────
import { Migration20260425T143139AnalyticsInit } from '../modules/analytics/migrations/20260425T143139_analytics_init.js';

// ── api_keys ──────────────────────────────────────────────────────────────
import { Migration20260724T173916ApiKeysDistributorBinding } from '../modules/api_keys/migrations/20260724T173916_api_keys_distributor_binding.js';

// ── assets_library ────────────────────────────────────────────────────────
import { Migration20260505T102206AssetsLibraryInit } from '../modules/assets_library/migrations/20260505T102206_assets_library_init.js';

// ── blog ──────────────────────────────────────────────────────────────────
import { Migration20260506T081055BlogInit } from '../modules/blog/migrations/20260506T081055_blog_init.js';

// ── carts ─────────────────────────────────────────────────────────────────
import { Migration20260611T140352CartsConsolidation } from '../modules/carts/migrations/20260611T140352_carts_consolidation.js';
import { Migration20260611T140413CartsCartItemPackaging } from '../modules/carts/migrations/20260611T140413_carts_cart_item_packaging.js';

// ── catalog ───────────────────────────────────────────────────────────────
import { Migration20260429T064146CatalogAttributeSetsInit } from '../modules/catalog/migrations/20260429T064146_catalog_attribute_sets_init.js';
import { Migration20260429T070004CatalogProductAttributeExtensions } from '../modules/catalog/migrations/20260429T070004_catalog_product_attribute_extensions.js';
import { Migration20260429T102322CatalogProductTypeAndVirtualFields } from '../modules/catalog/migrations/20260429T102322_catalog_product_type_and_virtual_fields.js';
import { Migration20260429T111839CatalogGalleryItemsAndLabels } from '../modules/catalog/migrations/20260429T111839_catalog_gallery_items_and_labels.js';
import { Migration20260429T112543CatalogProductAttachments } from '../modules/catalog/migrations/20260429T112543_catalog_product_attachments.js';
import { Migration20260429T123726CatalogProductLinks } from '../modules/catalog/migrations/20260429T123726_catalog_product_links.js';
import { Migration20260429T130803CatalogGroupedAndBundle } from '../modules/catalog/migrations/20260429T130803_catalog_grouped_and_bundle.js';
import { Migration20260501T185835CatalogProductAttributeIsComparable } from '../modules/catalog/migrations/20260501T185835_catalog_product_attribute_is_comparable.js';
import { Migration20260505T060113CatalogAttributeOptionsAndFlags } from '../modules/catalog/migrations/20260505T060113_catalog_attribute_options_and_flags.js';
import { Migration20260515T082629CatalogAttributeMassEditable } from '../modules/catalog/migrations/20260515T082629_catalog_attribute_mass_editable.js';
import { Migration20260526T124736CatalogProductStatusInactive } from '../modules/catalog/migrations/20260526T124736_catalog_product_status_inactive.js';
import { Migration20260611T140346CatalogProductValueOverridesInit } from '../modules/catalog/migrations/20260611T140346_catalog_product_value_overrides_init.js';
import { Migration20260611T140400CatalogAttributeQuickSearchable } from '../modules/catalog/migrations/20260611T140400_catalog_attribute_quick_searchable.js';
import { Migration20260611T140407CatalogBulkOperations } from '../modules/catalog/migrations/20260611T140407_catalog_bulk_operations.js';
import { Migration20260611T140408CatalogBulkOperationLogs } from '../modules/catalog/migrations/20260611T140408_catalog_bulk_operation_logs.js';
import { Migration20260611T140412CatalogProductPackagingUnits } from '../modules/catalog/migrations/20260611T140412_catalog_product_packaging_units.js';
import { Migration20260718T060659CatalogBulkOperationRevertState } from '../modules/catalog/migrations/20260718T060659_catalog_bulk_operation_revert_state.js';
import { Migration20260718T200343CatalogCategoryCustomFieldValues } from '../modules/catalog/migrations/20260718T200343_catalog_category_custom_field_values.js';
import { Migration20260723T230401CatalogAttributesOnCustomFields } from '../modules/catalog/migrations/20260723T230401_catalog_attributes_on_custom_fields.js';

// ── cms ───────────────────────────────────────────────────────────────────
import { Migration20260425T162418CmsPagesInit } from '../modules/cms/migrations/20260425T162418_cms_pages_init.js';
import { Migration20260505T130214CmsInit } from '../modules/cms/migrations/20260505T130214_cms_init.js';

// ── comparisons ───────────────────────────────────────────────────────────
import { Migration20260501T185834ComparisonsInit } from '../modules/comparisons/migrations/20260501T185834_comparisons_init.js';

// ── core ──────────────────────────────────────────────────────────────────
import { Migration20260424T165847CoreFoundationInit } from './migrations/20260424T165847_core_foundation_init.js';
import { Migration20260425T050720CoreCommerceInit } from './migrations/20260425T050720_core_commerce_init.js';
import { Migration20260506T200657CoreModuleLifecycleInit } from './migrations/20260506T200657_core_module_lifecycle_init.js';
import { Migration20260717T134752CoreTenantScopeIndexes } from './migrations/20260717T134752_core_tenant_scope_indexes.js';

// ── credentials ───────────────────────────────────────────────────────────
import { Migration20260721T011509CredentialsInit } from '../modules/credentials/migrations/20260721T011509_credentials_init.js';

// ── credit_limits ─────────────────────────────────────────────────────────
import { Migration20260425T063333CreditLimitsInit } from '../modules/credit_limits/migrations/20260425T063333_credit_limits_init.js';

// ── custom_fields ─────────────────────────────────────────────────────────
import { Migration20260718T200338CustomFieldsInit } from '../modules/custom_fields/migrations/20260718T200338_custom_fields_init.js';

// ── customer_accounts ─────────────────────────────────────────────────────
import { Migration20260425T055041CustomerAccountsPasswordResetTokens } from '../modules/customer_accounts/migrations/20260425T055041_customer_accounts_password_reset_tokens.js';
import { Migration20260611T140351CustomerAccountsOrganizationOptional } from '../modules/customer_accounts/migrations/20260611T140351_customer_accounts_organization_optional.js';
import { Migration20260611T140403CustomerAccountsLifecycle } from '../modules/customer_accounts/migrations/20260611T140403_customer_accounts_lifecycle.js';
import { Migration20260718T200341CustomerAccountsCustomerAccountCustomFieldValues } from '../modules/customer_accounts/migrations/20260718T200341_customer_accounts_customer_account_custom_field_values.js';
import { Migration20260720T044255CustomerAccountsCustomerSubtreeRollup } from '../modules/customer_accounts/migrations/20260720T044255_customer_accounts_customer_subtree_rollup.js';

// ── customers ─────────────────────────────────────────────────────────────
import { Migration20260611T140404CustomersCustomerAddressesInit } from '../modules/customers/migrations/20260611T140404_customers_customer_addresses_init.js';

// ── delivery_methods ──────────────────────────────────────────────────────
import { Migration20260611T140354DeliveryMethodsShippingMethodsAdapterAndShipments } from '../modules/delivery_methods/migrations/20260611T140354_delivery_methods_shipping_methods_adapter_and_shipments.js';
import { Migration20260611T140416DeliveryMethodsFixInPersonPickupAdapter } from '../modules/delivery_methods/migrations/20260611T140416_delivery_methods_fix_in_person_pickup_adapter.js';

// ── dictionaries ──────────────────────────────────────────────────────────
import { Migration20260506T112634DictionariesDictionaryInit } from '../modules/dictionaries/migrations/20260506T112634_dictionaries_dictionary_init.js';

// ── google_analytics ──────────────────────────────────────────────────────
import { Migration20260715T171116GoogleAnalyticsInit } from '../modules/google_analytics/migrations/20260715T171116_google_analytics_init.js';

// ── inventory ─────────────────────────────────────────────────────────────
import { Migration20260503T182812InventoryWorkflow } from '../modules/inventory/migrations/20260503T182812_inventory_workflow.js';
import { Migration20260611T140347InventoryWarehouseDefaultLowStockThreshold } from '../modules/inventory/migrations/20260611T140347_inventory_warehouse_default_low_stock_threshold.js';
import { Migration20260611T140348InventoryPerWarehouseLowStockThresholds } from '../modules/inventory/migrations/20260611T140348_inventory_per_warehouse_low_stock_thresholds.js';

// ── invoices ──────────────────────────────────────────────────────────────
import { Migration20260629T125121InvoicesModule } from '../modules/invoices/migrations/20260629T125121_invoices_module.js';
import { Migration20260801T111000InvoiceGenericTemplateReseed } from '../modules/invoices/migrations/20260801T111000_invoice_generic_template_reseed.js';

// ── ksef ──────────────────────────────────────────────────────────────────
import { Migration20260722T224358KsefInit } from '../modules/ksef/migrations/20260722T224358_ksef_init.js';

// ── languages ─────────────────────────────────────────────────────────────
import { Migration20260425T161557LanguagesCurrenciesInit } from '../modules/languages/migrations/20260425T161557_languages_currencies_init.js';

// ── linkedin_ads ──────────────────────────────────────────────────────────
import { Migration20260727T233211LinkedinAdsInit } from '../modules/linkedin_ads/migrations/20260727T233211_linkedin_ads_init.js';

// ── megamenu ──────────────────────────────────────────────────────────────
import { Migration20260505T193836MegamenuInit } from '../modules/megamenu/migrations/20260505T193836_megamenu_init.js';

// ── meta_ads ──────────────────────────────────────────────────────────────
import { Migration20260728T002715MetaAdsInit } from '../modules/meta_ads/migrations/20260728T002715_meta_ads_init.js';

// ── mfa ───────────────────────────────────────────────────────────────────
import { Migration20260611T140409MfaInit } from '../modules/mfa/migrations/20260611T140409_mfa_init.js';

// ── newsletter ────────────────────────────────────────────────────────────
import { Migration20260629T200954NewsletterInit } from '../modules/newsletter/migrations/20260629T200954_newsletter_init.js';

// ── orders ────────────────────────────────────────────────────────────────
import { Migration20260611T140355OrdersBusinessId } from '../modules/orders/migrations/20260611T140355_orders_business_id.js';
import { Migration20260611T140356OrdersStatusModel } from '../modules/orders/migrations/20260611T140356_orders_status_model.js';
import { Migration20260611T140357OrdersOrderCommentsAndSavedViews } from '../modules/orders/migrations/20260611T140357_orders_order_comments_and_saved_views.js';
import { Migration20260611T140401OrdersOrderStatusDefaultName } from '../modules/orders/migrations/20260611T140401_orders_order_status_default_name.js';
import { Migration20260611T140405OrdersOrderStatusColor } from '../modules/orders/migrations/20260611T140405_orders_order_status_color.js';
import { Migration20260611T140406OrdersOrderSavedViewColumns } from '../modules/orders/migrations/20260611T140406_orders_order_saved_view_columns.js';
import { Migration20260611T140414OrdersOrderItemPackaging } from '../modules/orders/migrations/20260611T140414_orders_order_item_packaging.js';
import { Migration20260618T130459OrdersOrderAppliedPromotions } from '../modules/orders/migrations/20260618T130459_orders_order_applied_promotions.js';
import { Migration20260718T200339OrdersOrderCustomFieldValues } from '../modules/orders/migrations/20260718T200339_orders_order_custom_field_values.js';
import { Migration20260724T193611OrdersOrderPlacementIntents } from '../modules/orders/migrations/20260724T193611_orders_order_placement_intents.js';

// ── organizations ─────────────────────────────────────────────────────────
import { Migration20260424T205317OrganizationsInit } from '../modules/organizations/migrations/20260424T205317_organizations_init.js';
import { Migration20260425T051700OrganizationsInvitationsInit } from '../modules/organizations/migrations/20260425T051700_organizations_invitations_init.js';
import { Migration20260611T140349OrganizationsConsolidation } from '../modules/organizations/migrations/20260611T140349_organizations_consolidation.js';
import { Migration20260611T140358OrganizationsOrgOrderConfirmationEmails } from '../modules/organizations/migrations/20260611T140358_organizations_org_order_confirmation_emails.js';
import { Migration20260611T140402OrganizationsOrgFulfilmentStrategy } from '../modules/organizations/migrations/20260611T140402_organizations_org_fulfilment_strategy.js';
import { Migration20260717T151403OrganizationsPersonalOrganizations } from '../modules/organizations/migrations/20260717T151403_organizations_personal_organizations.js';
import { Migration20260718T200340OrganizationsOrganizationCustomFieldValues } from '../modules/organizations/migrations/20260718T200340_organizations_organization_custom_field_values.js';
import { Migration20260720T044254OrganizationsOrgHierarchy } from '../modules/organizations/migrations/20260720T044254_organizations_org_hierarchy.js';

// ── payment_methods ───────────────────────────────────────────────────────
import { Migration20260611T140353PaymentMethodsAdapter } from '../modules/payment_methods/migrations/20260611T140353_payment_methods_adapter.js';

// ── payu ──────────────────────────────────────────────────────────────────
import { Migration20260801T100943PayuInit } from '../modules/payu/migrations/20260801T100943_payu_init.js';

// ── price_lists ───────────────────────────────────────────────────────────
import { Migration20260426T075235PriceListsPricingInit } from '../modules/price_lists/migrations/20260426T075235_price_lists_pricing_init.js';
import { Migration20260504T125655PriceListsEngine } from '../modules/price_lists/migrations/20260504T125655_price_lists_engine.js';

// ── promotions ────────────────────────────────────────────────────────────
import { Migration20260505T074605PromotionsCriteria } from '../modules/promotions/migrations/20260505T074605_promotions_criteria.js';
import { Migration20260618T100727PromotionsEngine } from '../modules/promotions/migrations/20260618T100727_promotions_engine.js';

// ── prompt_actions ────────────────────────────────────────────────────────
import { Migration20260611T140410PromptActionsInit } from '../modules/prompt_actions/migrations/20260611T140410_prompt_actions_init.js';

// ── pwa ───────────────────────────────────────────────────────────────────
import { Migration20260625T144228PwaInit } from '../modules/pwa/migrations/20260625T144228_pwa_init.js';

// ── quick_order ───────────────────────────────────────────────────────────
import { Migration20260611T140359QuickOrderDefaultPreferences } from '../modules/quick_order/migrations/20260611T140359_quick_order_default_preferences.js';

// ── quote_requests ────────────────────────────────────────────────────────
import { Migration20260424T190112QuoteRequestsInit } from '../modules/quote_requests/migrations/20260424T190112_quote_requests_init.js';
import { Migration20260503T141344QuoteRequestsWorkflow } from '../modules/quote_requests/migrations/20260503T141344_quote_requests_workflow.js';
import { Migration20260611T140415QuoteRequestsQrItemPackaging } from '../modules/quote_requests/migrations/20260611T140415_quote_requests_qr_item_packaging.js';
import { Migration20260611T140417QuoteRequestsBusinessId } from '../modules/quote_requests/migrations/20260611T140417_quote_requests_business_id.js';
import { Migration20260617T095510QuoteRequestsBackfillAdminCreatedAwaiting } from '../modules/quote_requests/migrations/20260617T095510_quote_requests_backfill_admin_created_awaiting.js';
import { Migration20260718T200342QuoteRequestsQuoteRequestCustomFieldValues } from '../modules/quote_requests/migrations/20260718T200342_quote_requests_quote_request_custom_field_values.js';

// ── returns ───────────────────────────────────────────────────────────────
import { Migration20260625T144227ReturnsInit } from '../modules/returns/migrations/20260625T144227_returns_init.js';

// ── sales_channels ────────────────────────────────────────────────────────
import { Migration20260430T170044SalesChannelsPromote } from '../modules/sales_channels/migrations/20260430T170044_sales_channels_promote.js';

// ── search ────────────────────────────────────────────────────────────────
import { Migration20260501T123145SearchPhraseRecordsInit } from '../modules/search/migrations/20260501T123145_search_phrase_records_init.js';

// ── seo ───────────────────────────────────────────────────────────────────
import { Migration20260425T154404SeoInit } from '../modules/seo/migrations/20260425T154404_seo_init.js';

// ── settings ──────────────────────────────────────────────────────────────
import { Migration20260430T101450SettingsInit } from '../modules/settings/migrations/20260430T101450_settings_init.js';
import { Migration20260514T111329SettingsGlobalValue } from '../modules/settings/migrations/20260514T111329_settings_global_value.js';
import { Migration20260611T140411SettingsSecretValueType } from '../modules/settings/migrations/20260611T140411_settings_secret_value_type.js';
import { Migration20260611T140419SettingsEnumOptions } from '../modules/settings/migrations/20260611T140419_settings_enum_options.js';
import { Migration20260629T090100SettingsHiddenFlag } from '../modules/settings/migrations/20260629T090100_settings_hidden_flag.js';
import { Migration20260721T011510SettingsCredentialRefValueType } from '../modules/settings/migrations/20260721T011510_settings_credential_ref_value_type.js';

// ── shopping_lists ────────────────────────────────────────────────────────
import { Migration20260426T135443ShoppingListsInit } from '../modules/shopping_lists/migrations/20260426T135443_shopping_lists_init.js';
import { Migration20260611T140418ShoppingListsDefault } from '../modules/shopping_lists/migrations/20260611T140418_shopping_lists_default.js';

// ── stripe ────────────────────────────────────────────────────────────────
import { Migration20260708T101135StripeInit } from '../modules/stripe/migrations/20260708T101135_stripe_init.js';
import { Migration20260715T103358StripePaymentRefundedAmount } from '../modules/stripe/migrations/20260715T103358_stripe_payment_refunded_amount.js';

// ── taxes ─────────────────────────────────────────────────────────────────
import { Migration20260426T081516TaxesPromotionsInit } from '../modules/taxes/migrations/20260426T081516_taxes_promotions_init.js';

// ── tpay ──────────────────────────────────────────────────────────────────
import { Migration20260729T132507TpayInit } from '../modules/tpay/migrations/20260729T132507_tpay_init.js';

// ── transactional_emails ──────────────────────────────────────────────────
import { Migration20260629T113442TransactionalEmailsInit } from '../modules/transactional_emails/migrations/20260629T113442_transactional_emails_init.js';
import { Migration20260801T111001EmailDefaultsReseed } from '../modules/transactional_emails/migrations/20260801T111001_email_defaults_reseed.js';

// ── webhooks ──────────────────────────────────────────────────────────────
import { Migration20260425T091359WebhooksUs7Init } from '../modules/webhooks/migrations/20260425T091359_webhooks_us7_init.js';
import { Migration20260724T203140WebhooksOrgFilter } from '../modules/webhooks/migrations/20260724T203140_webhooks_org_filter.js';
import { Migration20260727T200555WebhooksDropExternalIntegrations } from '../modules/webhooks/migrations/20260727T200555_webhooks_drop_external_integrations.js';

export type { MigrationClass, MigrationRegistryEntry };

/** One-line helper: the migration name is always `cls.name`, never hand-written. */
function migration(moduleId: string, cls: MigrationClass): MigrationRegistryEntry {
  return { moduleId, cls };
}

export const MIGRATION_REGISTRY: readonly MigrationRegistryEntry[] = [
  // ── _i18n ─────────────────────────────────────────────────────────────────
  migration('_i18n', Migration20260507T091405I18nAdminI18nInit),

  // ── admin_actions ─────────────────────────────────────────────────────────
  migration('admin_actions', Migration20260507T142354AdminActionsInit),

  // ── admin_notifications ───────────────────────────────────────────────────
  migration('admin_notifications', Migration20260611T140350AdminNotificationsInit),

  // ── admin_users ───────────────────────────────────────────────────────────
  migration('admin_users', Migration20260425T053028AdminUsersInit),

  // ── analytics ─────────────────────────────────────────────────────────────
  migration('analytics', Migration20260425T143139AnalyticsInit),

  // ── api_keys ──────────────────────────────────────────────────────────────
  migration('api_keys', Migration20260724T173916ApiKeysDistributorBinding),

  // ── assets_library ────────────────────────────────────────────────────────
  migration('assets_library', Migration20260505T102206AssetsLibraryInit),

  // ── blog ──────────────────────────────────────────────────────────────────
  migration('blog', Migration20260506T081055BlogInit),

  // ── carts ─────────────────────────────────────────────────────────────────
  migration('carts', Migration20260611T140352CartsConsolidation),
  migration('carts', Migration20260611T140413CartsCartItemPackaging),

  // ── catalog ───────────────────────────────────────────────────────────────
  migration('catalog', Migration20260429T064146CatalogAttributeSetsInit),
  migration('catalog', Migration20260429T070004CatalogProductAttributeExtensions),
  migration('catalog', Migration20260429T102322CatalogProductTypeAndVirtualFields),
  migration('catalog', Migration20260429T111839CatalogGalleryItemsAndLabels),
  migration('catalog', Migration20260429T112543CatalogProductAttachments),
  migration('catalog', Migration20260429T123726CatalogProductLinks),
  migration('catalog', Migration20260429T130803CatalogGroupedAndBundle),
  migration('catalog', Migration20260501T185835CatalogProductAttributeIsComparable),
  migration('catalog', Migration20260505T060113CatalogAttributeOptionsAndFlags),
  migration('catalog', Migration20260515T082629CatalogAttributeMassEditable),
  migration('catalog', Migration20260526T124736CatalogProductStatusInactive),
  migration('catalog', Migration20260611T140346CatalogProductValueOverridesInit),
  migration('catalog', Migration20260611T140400CatalogAttributeQuickSearchable),
  migration('catalog', Migration20260611T140407CatalogBulkOperations),
  migration('catalog', Migration20260611T140408CatalogBulkOperationLogs),
  migration('catalog', Migration20260611T140412CatalogProductPackagingUnits),
  migration('catalog', Migration20260718T060659CatalogBulkOperationRevertState),
  migration('catalog', Migration20260718T200343CatalogCategoryCustomFieldValues),
  migration('catalog', Migration20260723T230401CatalogAttributesOnCustomFields),

  // ── cms ───────────────────────────────────────────────────────────────────
  migration('cms', Migration20260425T162418CmsPagesInit),
  migration('cms', Migration20260505T130214CmsInit),

  // ── comparisons ───────────────────────────────────────────────────────────
  migration('comparisons', Migration20260501T185834ComparisonsInit),

  // ── core ──────────────────────────────────────────────────────────────────
  migration('core', Migration20260424T165847CoreFoundationInit),
  migration('core', Migration20260425T050720CoreCommerceInit),
  migration('core', Migration20260506T200657CoreModuleLifecycleInit),
  migration('core', Migration20260717T134752CoreTenantScopeIndexes),

  // ── credentials ───────────────────────────────────────────────────────────
  migration('credentials', Migration20260721T011509CredentialsInit),

  // ── credit_limits ─────────────────────────────────────────────────────────
  migration('credit_limits', Migration20260425T063333CreditLimitsInit),

  // ── custom_fields ─────────────────────────────────────────────────────────
  migration('custom_fields', Migration20260718T200338CustomFieldsInit),

  // ── customer_accounts ─────────────────────────────────────────────────────
  migration('customer_accounts', Migration20260425T055041CustomerAccountsPasswordResetTokens),
  migration('customer_accounts', Migration20260611T140351CustomerAccountsOrganizationOptional),
  migration('customer_accounts', Migration20260611T140403CustomerAccountsLifecycle),
  migration(
    'customer_accounts',
    Migration20260718T200341CustomerAccountsCustomerAccountCustomFieldValues,
  ),
  migration('customer_accounts', Migration20260720T044255CustomerAccountsCustomerSubtreeRollup),

  // ── customers ─────────────────────────────────────────────────────────────
  migration('customers', Migration20260611T140404CustomersCustomerAddressesInit),

  // ── delivery_methods ──────────────────────────────────────────────────────
  migration(
    'delivery_methods',
    Migration20260611T140354DeliveryMethodsShippingMethodsAdapterAndShipments,
  ),
  migration('delivery_methods', Migration20260611T140416DeliveryMethodsFixInPersonPickupAdapter),

  // ── dictionaries ──────────────────────────────────────────────────────────
  migration('dictionaries', Migration20260506T112634DictionariesDictionaryInit),

  // ── google_analytics ──────────────────────────────────────────────────────
  migration('google_analytics', Migration20260715T171116GoogleAnalyticsInit),

  // ── inventory ─────────────────────────────────────────────────────────────
  migration('inventory', Migration20260503T182812InventoryWorkflow),
  migration('inventory', Migration20260611T140347InventoryWarehouseDefaultLowStockThreshold),
  migration('inventory', Migration20260611T140348InventoryPerWarehouseLowStockThresholds),

  // ── invoices ──────────────────────────────────────────────────────────────
  migration('invoices', Migration20260629T125121InvoicesModule),
  migration('invoices', Migration20260801T111000InvoiceGenericTemplateReseed),

  // ── ksef ──────────────────────────────────────────────────────────────────
  migration('ksef', Migration20260722T224358KsefInit),

  // ── languages ─────────────────────────────────────────────────────────────
  migration('languages', Migration20260425T161557LanguagesCurrenciesInit),

  // ── linkedin_ads ──────────────────────────────────────────────────────────
  migration('linkedin_ads', Migration20260727T233211LinkedinAdsInit),

  // ── megamenu ──────────────────────────────────────────────────────────────
  migration('megamenu', Migration20260505T193836MegamenuInit),

  // ── meta_ads ──────────────────────────────────────────────────────────────
  migration('meta_ads', Migration20260728T002715MetaAdsInit),

  // ── mfa ───────────────────────────────────────────────────────────────────
  migration('mfa', Migration20260611T140409MfaInit),

  // ── newsletter ────────────────────────────────────────────────────────────
  migration('newsletter', Migration20260629T200954NewsletterInit),

  // ── orders ────────────────────────────────────────────────────────────────
  migration('orders', Migration20260611T140355OrdersBusinessId),
  migration('orders', Migration20260611T140356OrdersStatusModel),
  migration('orders', Migration20260611T140357OrdersOrderCommentsAndSavedViews),
  migration('orders', Migration20260611T140401OrdersOrderStatusDefaultName),
  migration('orders', Migration20260611T140405OrdersOrderStatusColor),
  migration('orders', Migration20260611T140406OrdersOrderSavedViewColumns),
  migration('orders', Migration20260611T140414OrdersOrderItemPackaging),
  migration('orders', Migration20260618T130459OrdersOrderAppliedPromotions),
  migration('orders', Migration20260718T200339OrdersOrderCustomFieldValues),
  migration('orders', Migration20260724T193611OrdersOrderPlacementIntents),

  // ── organizations ─────────────────────────────────────────────────────────
  migration('organizations', Migration20260424T205317OrganizationsInit),
  migration('organizations', Migration20260425T051700OrganizationsInvitationsInit),
  migration('organizations', Migration20260611T140349OrganizationsConsolidation),
  migration('organizations', Migration20260611T140358OrganizationsOrgOrderConfirmationEmails),
  migration('organizations', Migration20260611T140402OrganizationsOrgFulfilmentStrategy),
  migration('organizations', Migration20260717T151403OrganizationsPersonalOrganizations),
  migration('organizations', Migration20260718T200340OrganizationsOrganizationCustomFieldValues),
  migration('organizations', Migration20260720T044254OrganizationsOrgHierarchy),

  // ── payment_methods ───────────────────────────────────────────────────────
  migration('payment_methods', Migration20260611T140353PaymentMethodsAdapter),

  // ── payu ──────────────────────────────────────────────────────────────────
  migration('payu', Migration20260801T100943PayuInit),

  // ── price_lists ───────────────────────────────────────────────────────────
  migration('price_lists', Migration20260426T075235PriceListsPricingInit),
  migration('price_lists', Migration20260504T125655PriceListsEngine),

  // ── promotions ────────────────────────────────────────────────────────────
  migration('promotions', Migration20260505T074605PromotionsCriteria),
  migration('promotions', Migration20260618T100727PromotionsEngine),

  // ── prompt_actions ────────────────────────────────────────────────────────
  migration('prompt_actions', Migration20260611T140410PromptActionsInit),

  // ── pwa ───────────────────────────────────────────────────────────────────
  migration('pwa', Migration20260625T144228PwaInit),

  // ── quick_order ───────────────────────────────────────────────────────────
  migration('quick_order', Migration20260611T140359QuickOrderDefaultPreferences),

  // ── quote_requests ────────────────────────────────────────────────────────
  migration('quote_requests', Migration20260424T190112QuoteRequestsInit),
  migration('quote_requests', Migration20260503T141344QuoteRequestsWorkflow),
  migration('quote_requests', Migration20260611T140415QuoteRequestsQrItemPackaging),
  migration('quote_requests', Migration20260611T140417QuoteRequestsBusinessId),
  migration('quote_requests', Migration20260617T095510QuoteRequestsBackfillAdminCreatedAwaiting),
  migration('quote_requests', Migration20260718T200342QuoteRequestsQuoteRequestCustomFieldValues),

  // ── returns ───────────────────────────────────────────────────────────────
  migration('returns', Migration20260625T144227ReturnsInit),

  // ── sales_channels ────────────────────────────────────────────────────────
  migration('sales_channels', Migration20260430T170044SalesChannelsPromote),

  // ── search ────────────────────────────────────────────────────────────────
  migration('search', Migration20260501T123145SearchPhraseRecordsInit),

  // ── seo ───────────────────────────────────────────────────────────────────
  migration('seo', Migration20260425T154404SeoInit),

  // ── settings ──────────────────────────────────────────────────────────────
  migration('settings', Migration20260430T101450SettingsInit),
  migration('settings', Migration20260514T111329SettingsGlobalValue),
  migration('settings', Migration20260611T140411SettingsSecretValueType),
  migration('settings', Migration20260611T140419SettingsEnumOptions),
  migration('settings', Migration20260629T090100SettingsHiddenFlag),
  migration('settings', Migration20260721T011510SettingsCredentialRefValueType),

  // ── shopping_lists ────────────────────────────────────────────────────────
  migration('shopping_lists', Migration20260426T135443ShoppingListsInit),
  migration('shopping_lists', Migration20260611T140418ShoppingListsDefault),

  // ── stripe ────────────────────────────────────────────────────────────────
  migration('stripe', Migration20260708T101135StripeInit),
  migration('stripe', Migration20260715T103358StripePaymentRefundedAmount),

  // ── taxes ─────────────────────────────────────────────────────────────────
  migration('taxes', Migration20260426T081516TaxesPromotionsInit),

  // ── tpay ──────────────────────────────────────────────────────────────────
  migration('tpay', Migration20260729T132507TpayInit),

  // ── transactional_emails ──────────────────────────────────────────────────
  migration('transactional_emails', Migration20260629T113442TransactionalEmailsInit),
  migration('transactional_emails', Migration20260801T111001EmailDefaultsReseed),

  // ── webhooks ──────────────────────────────────────────────────────────────
  migration('webhooks', Migration20260425T091359WebhooksUs7Init),
  migration('webhooks', Migration20260724T203140WebhooksOrgFilter),
  migration('webhooks', Migration20260727T200555WebhooksDropExternalIntegrations),
];
