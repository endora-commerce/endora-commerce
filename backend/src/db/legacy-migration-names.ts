/**
 * Frozen rename map for the 112 migrations that existed before feature 065
 * replaced the global sequential counter with timestamp-prefixed names.
 *
 * FROZEN — do not append, reorder, or edit. Array order IS the historical
 * execution order: the `migrationsList` array order of
 * backend/src/db/mikro-orm.config.ts as of commit 8771dcd9, which is what every
 * deployed database executed (MikroORM hands migrationsList to umzug unsorted).
 *
 * The timestamps were derived once by
 * backend/scripts/derive-legacy-migration-timestamps.ts per
 * specs/065-manifest-aware-migrations/contracts/legacy-rename-map.md §2.2 and
 * are never recomputed. The pre-flight in ./legacy-migration-rename.ts rewrites
 * `mikro_orm_migrations.name` from `legacyName` to `name` so a deployed
 * database does not see 112 pending migrations after the rename.
 */

export interface LegacyMigrationRename {
  /** The name recorded in mikro_orm_migrations before feature 065. */
  legacyName: string;
  /** The name after the rename — the current migration class name. */
  name: string;
}

export const LEGACY_MIGRATION_RENAMES: readonly LegacyMigrationRename[] = [
  { legacyName: 'Migration001FoundationInit', name: 'Migration20260424T165847CoreFoundationInit' },
  {
    legacyName: 'Migration002QuoteRequestsInit',
    name: 'Migration20260424T190112QuoteRequestsInit',
  },
  {
    legacyName: 'Migration003OrganizationsInit',
    name: 'Migration20260424T205317OrganizationsInit',
  },
  { legacyName: 'Migration004CommerceInit', name: 'Migration20260425T050720CoreCommerceInit' },
  {
    legacyName: 'Migration005InvitationsInit',
    name: 'Migration20260425T051700OrganizationsInvitationsInit',
  },
  { legacyName: 'Migration006AdminUsersInit', name: 'Migration20260425T053028AdminUsersInit' },
  {
    legacyName: 'Migration007PasswordResetTokens',
    name: 'Migration20260425T055041CustomerAccountsPasswordResetTokens',
  },
  { legacyName: 'Migration008CreditLimitsInit', name: 'Migration20260425T063333CreditLimitsInit' },
  { legacyName: 'Migration009Us7Init', name: 'Migration20260425T091359WebhooksUs7Init' },
  { legacyName: 'Migration010AnalyticsInit', name: 'Migration20260425T143139AnalyticsInit' },
  { legacyName: 'Migration011SeoInit', name: 'Migration20260425T154404SeoInit' },
  {
    legacyName: 'Migration012LanguagesCurrenciesInit',
    name: 'Migration20260425T161557LanguagesCurrenciesInit',
  },
  { legacyName: 'Migration013CmsPagesInit', name: 'Migration20260425T162418CmsPagesInit' },
  { legacyName: 'Migration014PricingInit', name: 'Migration20260426T075235PriceListsPricingInit' },
  {
    legacyName: 'Migration015TaxesPromotionsInit',
    name: 'Migration20260426T081516TaxesPromotionsInit',
  },
  {
    legacyName: 'Migration016ShoppingListsInit',
    name: 'Migration20260426T135443ShoppingListsInit',
  },
  {
    legacyName: 'Migration017AttributeSetsInit',
    name: 'Migration20260429T064146CatalogAttributeSetsInit',
  },
  {
    legacyName: 'Migration018ProductAttributeExtensions',
    name: 'Migration20260429T070004CatalogProductAttributeExtensions',
  },
  {
    legacyName: 'Migration019ProductTypeAndVirtualFields',
    name: 'Migration20260429T102322CatalogProductTypeAndVirtualFields',
  },
  {
    legacyName: 'Migration020GalleryItemsAndLabels',
    name: 'Migration20260429T111839CatalogGalleryItemsAndLabels',
  },
  {
    legacyName: 'Migration021ProductAttachments',
    name: 'Migration20260429T112543CatalogProductAttachments',
  },
  { legacyName: 'Migration022ProductLinks', name: 'Migration20260429T123726CatalogProductLinks' },
  {
    legacyName: 'Migration023GroupedAndBundle',
    name: 'Migration20260429T130803CatalogGroupedAndBundle',
  },
  { legacyName: 'Migration024SettingsInit', name: 'Migration20260430T101450SettingsInit' },
  {
    legacyName: 'Migration025SalesChannelsPromote',
    name: 'Migration20260430T170044SalesChannelsPromote',
  },
  {
    legacyName: 'Migration026SearchPhraseRecordsInit',
    name: 'Migration20260501T123145SearchPhraseRecordsInit',
  },
  { legacyName: 'Migration027ComparisonsInit', name: 'Migration20260501T185834ComparisonsInit' },
  {
    legacyName: 'Migration028ProductAttributeIsComparable',
    name: 'Migration20260501T185835CatalogProductAttributeIsComparable',
  },
  {
    legacyName: 'Migration029QuoteRequestsWorkflow',
    name: 'Migration20260503T141344QuoteRequestsWorkflow',
  },
  {
    legacyName: 'Migration030InventoryWorkflow',
    name: 'Migration20260503T182812InventoryWorkflow',
  },
  { legacyName: 'Migration031PriceListsEngine', name: 'Migration20260504T125655PriceListsEngine' },
  {
    legacyName: 'Migration032AttributeOptionsAndFlags',
    name: 'Migration20260505T060113CatalogAttributeOptionsAndFlags',
  },
  {
    legacyName: 'Migration033PromotionsCriteria',
    name: 'Migration20260505T074605PromotionsCriteria',
  },
  {
    legacyName: 'Migration034AssetsLibraryInit',
    name: 'Migration20260505T102206AssetsLibraryInit',
  },
  { legacyName: 'Migration035CmsInit', name: 'Migration20260505T130214CmsInit' },
  { legacyName: 'Migration036MegamenuInit', name: 'Migration20260505T193836MegamenuInit' },
  { legacyName: 'Migration037BlogInit', name: 'Migration20260506T081055BlogInit' },
  {
    legacyName: 'Migration038DictionaryInit',
    name: 'Migration20260506T112634DictionariesDictionaryInit',
  },
  {
    legacyName: 'Migration039ModuleLifecycleInit',
    name: 'Migration20260506T200657CoreModuleLifecycleInit',
  },
  { legacyName: 'Migration040AdminI18nInit', name: 'Migration20260507T091405I18nAdminI18nInit' },
  { legacyName: 'Migration041AdminActionsInit', name: 'Migration20260507T142354AdminActionsInit' },
  {
    legacyName: 'Migration042SettingsGlobalValue',
    name: 'Migration20260514T111329SettingsGlobalValue',
  },
  {
    legacyName: 'Migration043AttributeMassEditable',
    name: 'Migration20260515T082629CatalogAttributeMassEditable',
  },
  {
    legacyName: 'Migration044ProductStatusInactive',
    name: 'Migration20260526T124736CatalogProductStatusInactive',
  },
  {
    legacyName: 'Migration044ProductValueOverridesInit',
    name: 'Migration20260611T140346CatalogProductValueOverridesInit',
  },
  {
    legacyName: 'Migration045WarehouseDefaultLowStockThreshold',
    name: 'Migration20260611T140347InventoryWarehouseDefaultLowStockThreshold',
  },
  {
    legacyName: 'Migration046PerWarehouseLowStockThresholds',
    name: 'Migration20260611T140348InventoryPerWarehouseLowStockThresholds',
  },
  {
    legacyName: 'Migration047OrganizationsConsolidation',
    name: 'Migration20260611T140349OrganizationsConsolidation',
  },
  {
    legacyName: 'Migration048AdminNotificationsInit',
    name: 'Migration20260611T140350AdminNotificationsInit',
  },
  {
    legacyName: 'Migration049CustomerAccountsOrganizationOptional',
    name: 'Migration20260611T140351CustomerAccountsOrganizationOptional',
  },
  {
    legacyName: 'Migration050CartsConsolidation',
    name: 'Migration20260611T140352CartsConsolidation',
  },
  {
    legacyName: 'Migration051PaymentMethodsAdapter',
    name: 'Migration20260611T140353PaymentMethodsAdapter',
  },
  {
    legacyName: 'Migration052ShippingMethodsAdapterAndShipments',
    name: 'Migration20260611T140354DeliveryMethodsShippingMethodsAdapterAndShipments',
  },
  { legacyName: 'Migration053OrdersBusinessId', name: 'Migration20260611T140355OrdersBusinessId' },
  {
    legacyName: 'Migration054OrdersStatusModel',
    name: 'Migration20260611T140356OrdersStatusModel',
  },
  {
    legacyName: 'Migration055OrderCommentsAndSavedViews',
    name: 'Migration20260611T140357OrdersOrderCommentsAndSavedViews',
  },
  {
    legacyName: 'Migration056OrgOrderConfirmationEmails',
    name: 'Migration20260611T140358OrganizationsOrgOrderConfirmationEmails',
  },
  {
    legacyName: 'Migration057QuickOrderDefaultPreferences',
    name: 'Migration20260611T140359QuickOrderDefaultPreferences',
  },
  {
    legacyName: 'Migration058AttributeQuickSearchable',
    name: 'Migration20260611T140400CatalogAttributeQuickSearchable',
  },
  {
    legacyName: 'Migration059OrderStatusDefaultName',
    name: 'Migration20260611T140401OrdersOrderStatusDefaultName',
  },
  {
    legacyName: 'Migration060OrgFulfilmentStrategy',
    name: 'Migration20260611T140402OrganizationsOrgFulfilmentStrategy',
  },
  {
    legacyName: 'Migration061CustomerAccountsLifecycle',
    name: 'Migration20260611T140403CustomerAccountsLifecycle',
  },
  {
    legacyName: 'Migration062CustomerAddressesInit',
    name: 'Migration20260611T140404CustomersCustomerAddressesInit',
  },
  {
    legacyName: 'Migration063OrderStatusColor',
    name: 'Migration20260611T140405OrdersOrderStatusColor',
  },
  {
    legacyName: 'Migration064OrderSavedViewColumns',
    name: 'Migration20260611T140406OrdersOrderSavedViewColumns',
  },
  {
    legacyName: 'Migration065CatalogBulkOperations',
    name: 'Migration20260611T140407CatalogBulkOperations',
  },
  {
    legacyName: 'Migration066BulkOperationLogs',
    name: 'Migration20260611T140408CatalogBulkOperationLogs',
  },
  { legacyName: 'Migration067MfaInit', name: 'Migration20260611T140409MfaInit' },
  {
    legacyName: 'Migration068PromptActionsInit',
    name: 'Migration20260611T140410PromptActionsInit',
  },
  {
    legacyName: 'Migration069SettingsSecretValueType',
    name: 'Migration20260611T140411SettingsSecretValueType',
  },
  {
    legacyName: 'Migration068ProductPackagingUnits',
    name: 'Migration20260611T140412CatalogProductPackagingUnits',
  },
  {
    legacyName: 'Migration069CartItemPackaging',
    name: 'Migration20260611T140413CartsCartItemPackaging',
  },
  {
    legacyName: 'Migration070OrderItemPackaging',
    name: 'Migration20260611T140414OrdersOrderItemPackaging',
  },
  {
    legacyName: 'Migration071QrItemPackaging',
    name: 'Migration20260611T140415QuoteRequestsQrItemPackaging',
  },
  {
    legacyName: 'Migration072FixInPersonPickupAdapter',
    name: 'Migration20260611T140416DeliveryMethodsFixInPersonPickupAdapter',
  },
  {
    legacyName: 'Migration073QuoteRequestsBusinessId',
    name: 'Migration20260611T140417QuoteRequestsBusinessId',
  },
  {
    legacyName: 'Migration074ShoppingListsDefault',
    name: 'Migration20260611T140418ShoppingListsDefault',
  },
  {
    legacyName: 'Migration075SettingsEnumOptions',
    name: 'Migration20260611T140419SettingsEnumOptions',
  },
  {
    legacyName: 'Migration076BackfillAdminCreatedAwaiting',
    name: 'Migration20260617T095510QuoteRequestsBackfillAdminCreatedAwaiting',
  },
  { legacyName: 'Migration077PromotionsEngine', name: 'Migration20260618T100727PromotionsEngine' },
  {
    legacyName: 'Migration079OrderAppliedPromotions',
    name: 'Migration20260618T130459OrdersOrderAppliedPromotions',
  },
  { legacyName: 'Migration080ReturnsInit', name: 'Migration20260625T144227ReturnsInit' },
  { legacyName: 'Migration080PwaInit', name: 'Migration20260625T144228PwaInit' },
  {
    legacyName: 'Migration081SettingsHiddenFlag',
    name: 'Migration20260629T090100SettingsHiddenFlag',
  },
  {
    legacyName: 'Migration082TransactionalEmailsInit',
    name: 'Migration20260629T113442TransactionalEmailsInit',
  },
  { legacyName: 'Migration083InvoicesModule', name: 'Migration20260629T125121InvoicesModule' },
  { legacyName: 'Migration084NewsletterInit', name: 'Migration20260629T200954NewsletterInit' },
  { legacyName: 'Migration085StripeInit', name: 'Migration20260708T101135StripeInit' },
  {
    legacyName: 'Migration086PaymentRefundedAmount',
    name: 'Migration20260715T103358StripePaymentRefundedAmount',
  },
  {
    legacyName: 'Migration087GoogleAnalyticsInit',
    name: 'Migration20260715T171116GoogleAnalyticsInit',
  },
  {
    legacyName: 'Migration088TenantScopeIndexes',
    name: 'Migration20260717T134752CoreTenantScopeIndexes',
  },
  {
    legacyName: 'Migration089PersonalOrganizations',
    name: 'Migration20260717T151403OrganizationsPersonalOrganizations',
  },
  {
    legacyName: 'Migration090BulkOperationRevertState',
    name: 'Migration20260718T060659CatalogBulkOperationRevertState',
  },
  { legacyName: 'Migration091CustomFieldsInit', name: 'Migration20260718T200338CustomFieldsInit' },
  {
    legacyName: 'Migration092OrderCustomFieldValues',
    name: 'Migration20260718T200339OrdersOrderCustomFieldValues',
  },
  {
    legacyName: 'Migration093OrganizationCustomFieldValues',
    name: 'Migration20260718T200340OrganizationsOrganizationCustomFieldValues',
  },
  {
    legacyName: 'Migration094CustomerAccountCustomFieldValues',
    name: 'Migration20260718T200341CustomerAccountsCustomerAccountCustomFieldValues',
  },
  {
    legacyName: 'Migration095QuoteRequestCustomFieldValues',
    name: 'Migration20260718T200342QuoteRequestsQuoteRequestCustomFieldValues',
  },
  {
    legacyName: 'Migration096CategoryCustomFieldValues',
    name: 'Migration20260718T200343CatalogCategoryCustomFieldValues',
  },
  {
    legacyName: 'Migration097OrgHierarchy',
    name: 'Migration20260720T044254OrganizationsOrgHierarchy',
  },
  {
    legacyName: 'Migration098CustomerSubtreeRollup',
    name: 'Migration20260720T044255CustomerAccountsCustomerSubtreeRollup',
  },
  { legacyName: 'Migration099CredentialsInit', name: 'Migration20260721T011509CredentialsInit' },
  {
    legacyName: 'Migration100SettingsCredentialRefValueType',
    name: 'Migration20260721T011510SettingsCredentialRefValueType',
  },
  { legacyName: 'Migration101KsefInit', name: 'Migration20260722T224358KsefInit' },
  {
    legacyName: 'Migration102AttributesOnCustomFields',
    name: 'Migration20260723T230401CatalogAttributesOnCustomFields',
  },
  {
    legacyName: 'Migration103ApiKeysDistributorBinding',
    name: 'Migration20260724T173916ApiKeysDistributorBinding',
  },
  {
    legacyName: 'Migration104OrderPlacementIntents',
    name: 'Migration20260724T193611OrdersOrderPlacementIntents',
  },
  {
    legacyName: 'Migration105WebhooksOrgFilter',
    name: 'Migration20260724T203140WebhooksOrgFilter',
  },
  {
    legacyName: 'Migration106DropExternalIntegrations',
    name: 'Migration20260727T200555WebhooksDropExternalIntegrations',
  },
  { legacyName: 'Migration107LinkedinAdsInit', name: 'Migration20260727T233211LinkedinAdsInit' },
  { legacyName: 'Migration108MetaAdsInit', name: 'Migration20260728T002715MetaAdsInit' },
  { legacyName: 'Migration109TpayInit', name: 'Migration20260729T132507TpayInit' },
];

/** Every migration at or before this stamp is order-frozen. Set once; never advanced. */
export const FROZEN_THROUGH = '20260801T000000';
