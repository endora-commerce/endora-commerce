import { describe, expect, it } from 'vitest';
import {
  FROZEN_THROUGH,
  LEGACY_MIGRATION_RENAMES,
} from '../../../src/db/legacy-migration-names.js';

/**
 * Shape assertions for the frozen legacy rename map — see
 * specs/065-manifest-aware-migrations/contracts/legacy-rename-map.md §2.3.
 *
 * The map is what keeps already-deployed databases intact across the
 * 112-migration rename. It is frozen: nothing may be appended, reordered or
 * edited after it landed.
 */

const LEGACY_NAME_RE = /^Migration\d{3}[A-Z]/;
const NEW_NAME_RE = /^Migration(\d{8}T\d{6})[A-Z0-9]/;

/**
 * The pre-change `migrationsList` array order of
 * backend/src/db/mikro-orm.config.ts at commit 8771dcd9 — the order every
 * deployed database actually executed (MikroORM hands migrationsList to umzug
 * unsorted). Inlined so this proof does not depend on a scratch file.
 */
const HISTORICAL_EXECUTION_ORDER: readonly string[] = [
  'Migration001FoundationInit',
  'Migration002QuoteRequestsInit',
  'Migration003OrganizationsInit',
  'Migration004CommerceInit',
  'Migration005InvitationsInit',
  'Migration006AdminUsersInit',
  'Migration007PasswordResetTokens',
  'Migration008CreditLimitsInit',
  'Migration009Us7Init',
  'Migration010AnalyticsInit',
  'Migration011SeoInit',
  'Migration012LanguagesCurrenciesInit',
  'Migration013CmsPagesInit',
  'Migration014PricingInit',
  'Migration015TaxesPromotionsInit',
  'Migration016ShoppingListsInit',
  'Migration017AttributeSetsInit',
  'Migration018ProductAttributeExtensions',
  'Migration019ProductTypeAndVirtualFields',
  'Migration020GalleryItemsAndLabels',
  'Migration021ProductAttachments',
  'Migration022ProductLinks',
  'Migration023GroupedAndBundle',
  'Migration024SettingsInit',
  'Migration025SalesChannelsPromote',
  'Migration026SearchPhraseRecordsInit',
  'Migration027ComparisonsInit',
  'Migration028ProductAttributeIsComparable',
  'Migration029QuoteRequestsWorkflow',
  'Migration030InventoryWorkflow',
  'Migration031PriceListsEngine',
  'Migration032AttributeOptionsAndFlags',
  'Migration033PromotionsCriteria',
  'Migration034AssetsLibraryInit',
  'Migration035CmsInit',
  'Migration036MegamenuInit',
  'Migration037BlogInit',
  'Migration038DictionaryInit',
  'Migration039ModuleLifecycleInit',
  'Migration040AdminI18nInit',
  'Migration041AdminActionsInit',
  'Migration042SettingsGlobalValue',
  'Migration043AttributeMassEditable',
  'Migration044ProductStatusInactive',
  'Migration044ProductValueOverridesInit',
  'Migration045WarehouseDefaultLowStockThreshold',
  'Migration046PerWarehouseLowStockThresholds',
  'Migration047OrganizationsConsolidation',
  'Migration048AdminNotificationsInit',
  'Migration049CustomerAccountsOrganizationOptional',
  'Migration050CartsConsolidation',
  'Migration051PaymentMethodsAdapter',
  'Migration052ShippingMethodsAdapterAndShipments',
  'Migration053OrdersBusinessId',
  'Migration054OrdersStatusModel',
  'Migration055OrderCommentsAndSavedViews',
  'Migration056OrgOrderConfirmationEmails',
  'Migration057QuickOrderDefaultPreferences',
  'Migration058AttributeQuickSearchable',
  'Migration059OrderStatusDefaultName',
  'Migration060OrgFulfilmentStrategy',
  'Migration061CustomerAccountsLifecycle',
  'Migration062CustomerAddressesInit',
  'Migration063OrderStatusColor',
  'Migration064OrderSavedViewColumns',
  'Migration065CatalogBulkOperations',
  'Migration066BulkOperationLogs',
  'Migration067MfaInit',
  'Migration068PromptActionsInit',
  'Migration069SettingsSecretValueType',
  'Migration068ProductPackagingUnits',
  'Migration069CartItemPackaging',
  'Migration070OrderItemPackaging',
  'Migration071QrItemPackaging',
  'Migration072FixInPersonPickupAdapter',
  'Migration073QuoteRequestsBusinessId',
  'Migration074ShoppingListsDefault',
  'Migration075SettingsEnumOptions',
  'Migration076BackfillAdminCreatedAwaiting',
  'Migration077PromotionsEngine',
  'Migration079OrderAppliedPromotions',
  'Migration080ReturnsInit',
  'Migration080PwaInit',
  'Migration081SettingsHiddenFlag',
  'Migration082TransactionalEmailsInit',
  'Migration083InvoicesModule',
  'Migration084NewsletterInit',
  'Migration085StripeInit',
  'Migration086PaymentRefundedAmount',
  'Migration087GoogleAnalyticsInit',
  'Migration088TenantScopeIndexes',
  'Migration089PersonalOrganizations',
  'Migration090BulkOperationRevertState',
  'Migration091CustomFieldsInit',
  'Migration092OrderCustomFieldValues',
  'Migration093OrganizationCustomFieldValues',
  'Migration094CustomerAccountCustomFieldValues',
  'Migration095QuoteRequestCustomFieldValues',
  'Migration096CategoryCustomFieldValues',
  'Migration097OrgHierarchy',
  'Migration098CustomerSubtreeRollup',
  'Migration099CredentialsInit',
  'Migration100SettingsCredentialRefValueType',
  'Migration101KsefInit',
  'Migration102AttributesOnCustomFields',
  'Migration103ApiKeysDistributorBinding',
  'Migration104OrderPlacementIntents',
  'Migration105WebhooksOrgFilter',
  'Migration106DropExternalIntegrations',
  'Migration107LinkedinAdsInit',
  'Migration108MetaAdsInit',
  'Migration109TpayInit',
];

describe('LEGACY_MIGRATION_RENAMES', () => {
  it('has exactly 112 entries', () => {
    expect(LEGACY_MIGRATION_RENAMES).toHaveLength(112);
  });

  it('every legacyName is a legacy-scheme name and unique', () => {
    const legacyNames = LEGACY_MIGRATION_RENAMES.map((rename) => rename.legacyName);
    const malformed = legacyNames.filter((name) => !LEGACY_NAME_RE.test(name));
    expect(malformed, `malformed legacy names: ${malformed.join(', ')}`).toEqual([]);
    expect(new Set(legacyNames).size).toBe(legacyNames.length);
  });

  it('every new name is a timestamped name and unique', () => {
    const newNames = LEGACY_MIGRATION_RENAMES.map((rename) => rename.name);
    const malformed = newNames.filter((name) => !NEW_NAME_RE.test(name));
    expect(malformed, `malformed new names: ${malformed.join(', ')}`).toEqual([]);
    expect(new Set(newNames).size).toBe(newNames.length);
  });

  it('timestamps strictly increase down the array', () => {
    const stamps = LEGACY_MIGRATION_RENAMES.map((rename) => NEW_NAME_RE.exec(rename.name)![1]!);
    const regressions: string[] = [];
    for (let index = 1; index < stamps.length; index += 1) {
      if (stamps[index]! <= stamps[index - 1]!) {
        regressions.push(
          `${LEGACY_MIGRATION_RENAMES[index - 1]!.name} (${stamps[index - 1]}) → ` +
            `${LEGACY_MIGRATION_RENAMES[index]!.name} (${stamps[index]})`,
        );
      }
    }
    expect(regressions, `non-increasing timestamps: ${regressions.join('; ')}`).toEqual([]);
  });

  it('every timestamp is at or before FROZEN_THROUGH', () => {
    const late = LEGACY_MIGRATION_RENAMES.map((rename) => rename.name).filter(
      (name) => NEW_NAME_RE.exec(name)![1]! > FROZEN_THROUGH,
    );
    expect(late, `entries after the frozen watermark: ${late.join(', ')}`).toEqual([]);
  });

  it('reproduces the historical execution order element for element (SC-004)', () => {
    expect(LEGACY_MIGRATION_RENAMES.map((rename) => rename.legacyName)).toEqual(
      HISTORICAL_EXECUTION_ORDER,
    );
  });

  it('FROZEN_THROUGH is the constant fixed by the plan', () => {
    expect(FROZEN_THROUGH).toBe('20260801T000000');
  });
});
