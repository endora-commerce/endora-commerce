import { describe, expect, it } from 'vitest';
import {
  BASELINE_THROUGH,
  orderMigrations,
  type MigrationRegistryEntry,
} from '../../../src/db/migration-order.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';

/**
 * The regression baseline for feature 081 (T001).
 *
 * `PRE_081_ORDER` below is the sequence `orderMigrations()` emitted over the
 * real registry under feature 065's algorithm — chronology corrected by
 * dependency-inversion edges inside a 45-day horizon — captured on
 * `master@c1aeb71a`, **before** `src/db/migration-order.ts` was rewritten. It
 * is a committed literal and is never regenerated: a baseline recomputed from
 * the code it is supposed to guard measures nothing.
 *
 * Three of the four claims below hold under both algorithms and are what makes
 * the rewrite safe on a live database:
 *
 * - the same migrations are emitted, each exactly once (no class was renamed,
 *   so nothing already in `mikro_orm_migrations` can become pending again);
 * - the frozen historical prefix is emitted identically;
 * - the emitted count is unchanged.
 *
 * The fourth — how many positions moved — is the measurement the rewrite is
 * allowed to change, and `EXPECTED_MOVED_POSITIONS` is a two-way ratchet over
 * it: a number that is too low and one that is too high both fail. Every moved
 * position must be in the open block.
 *
 * Note on the counts. `specs/081-per-module-migration-order/` measured 141
 * migrations (112 baseline, 29 open) against `master@4186aec0`. Four
 * migrations have landed since —
 * `Migration20260819T074816CustomerAccountsPasswordSetAt`,
 * `Migration20260819T142837CustomerAccountsFoldEmailCase`,
 * `Migration20260819T155150AdminUsersFoldEmailCase` and
 * `Migration20260819T171006ShipmentsStatusPendingManual`, all open-block
 * entries — so the numbers here are 145/112/33. The frozen prefix, which is the
 * claim the feature rests on, is the spec's 112 unchanged.
 *
 * A new migration is added to `PRE_081_ORDER` in the position feature 065's
 * algorithm would have emitted it. That position is **computed, not guessed**:
 * the 065 algorithm is a pure function and it is still in the history, so
 * running `orderMigrations` as of `master@a139e1b7^` over today's registry
 * reproduces this literal entry for entry and says where the new name lands.
 * It is not a regeneration by the code this baseline guards — that code is the
 * rewritten `src/db/migration-order.ts`, and it emits the new name three
 * positions earlier. The 143 positions the literal already held are untouched,
 * and `EXPECTED_MOVED_POSITIONS` stayed at 26, which is the evidence that the
 * insertion did not move anybody.
 */

const FROZEN_PREFIX_LENGTH = 112;

/**
 * How many positions the emitted order differs from `PRE_081_ORDER` in.
 *
 * Feature 081 moved it from 0 to **26**, and no later change may move it
 * again without saying why. All 26 are in the open block, where the rule
 * changed from "chronology, corrected inside a 45-day horizon" to "module by
 * module in dependency order" — the spec measured the same 26 against
 * `master@4186aec0`. Four open-block entries keep their position by
 * coincidence, and the frozen prefix keeps all 112 of its own by rule.
 *
 * A database that has applied them does not care: `mikro_orm_migrations` keys
 * applied work by class name, no name moved, and umzug filters applied
 * migrations out of `pending` regardless of list position. Measured, not
 * assumed — see the rehearsal in the merge request.
 *
 * **26 → 28**, and this is the "saying why". Issue #249's backfill
 * (`Migration20260819T155150AdminUsersFoldEmailCase`) is the first migration
 * the two algorithms place differently: 065's chronology puts it at 115, among
 * the August stamps it sits between, while 081 puts it at 113 because
 * `admin_users` comes early in the dependency topological order. Exactly two
 * positions change status — the new migration itself, and
 * `Migration20260817T070014EmailDeliveryRecord`, which the new entry displaces
 * from 113 to 114 in the emitted order while the frozen baseline keeps it at
 * 113. Nothing else moves, and nothing in the frozen prefix does. A migration
 * that lands on a position the two algorithms agree about still leaves this
 * number alone; one that does not is expected to move it, by two, and to say
 * which two.
 *
 * **28 → 29, by one**, and this is that saying. Issue #250's
 * `Migration20260819T171006ShipmentsStatusPendingManual` is the newest stamp in
 * the registry, so 065's chronology emits it **last**, at 144; 081 emits it at
 * 142, immediately after `Migration20260817T194652ShipmentsOrderFk`, because a
 * module's migrations are contiguous and `shipments` precedes the four PSP
 * modules in the dependency topological order. Exactly one position changes
 * status — the new migration's own. `StripeSeedPaymentMethods` and
 * `TpaySeedPaymentMethods` shift from 142/143 to 143/144 but were already
 * moved, so the count grows by one rather than by three. Measured by running
 * 065's `orderMigrations` (from `master@a139e1b7^`) over the registry with and
 * without the new entry, which is the method the paragraph above prescribes.
 */
const EXPECTED_MOVED_POSITIONS = 29;

const MODULE_DEPENDENCIES: ReadonlyMap<string, readonly string[]> = new Map<
  string,
  readonly string[]
>([
  ['core', []],
  ...DISCOVERED_MANIFESTS.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const),
]);

function emittedOrder(entries: readonly MigrationRegistryEntry[] = MIGRATION_REGISTRY): string[] {
  return orderMigrations({
    entries,
    moduleDependencies: MODULE_DEPENDENCIES,
    baselineThrough: BASELINE_THROUGH,
  }).migrations.map((migration) => migration.name);
}

/** The order feature 065's algorithm emitted, captured verbatim. Do not regenerate. */
const PRE_081_ORDER: readonly string[] = [
  'Migration20260424T165847CoreFoundationInit',
  'Migration20260424T190112QuoteRequestsInit',
  'Migration20260424T205317OrganizationsInit',
  'Migration20260425T050720CoreCommerceInit',
  'Migration20260425T051700OrganizationsInvitationsInit',
  'Migration20260425T053028AdminUsersInit',
  'Migration20260425T055041CustomerAccountsPasswordResetTokens',
  'Migration20260425T063333CreditLimitsInit',
  'Migration20260425T091359WebhooksUs7Init',
  'Migration20260425T143139AnalyticsInit',
  'Migration20260425T154404SeoInit',
  'Migration20260425T161557LanguagesCurrenciesInit',
  'Migration20260425T162418CmsPagesInit',
  'Migration20260426T075235PriceListsPricingInit',
  'Migration20260426T081516TaxesPromotionsInit',
  'Migration20260426T135443ShoppingListsInit',
  'Migration20260429T064146CatalogAttributeSetsInit',
  'Migration20260429T070004CatalogProductAttributeExtensions',
  'Migration20260429T102322CatalogProductTypeAndVirtualFields',
  'Migration20260429T111839CatalogGalleryItemsAndLabels',
  'Migration20260429T112543CatalogProductAttachments',
  'Migration20260429T123726CatalogProductLinks',
  'Migration20260429T130803CatalogGroupedAndBundle',
  'Migration20260430T101450CoreSettingsInit',
  'Migration20260430T170044CoreSalesChannelsPromote',
  'Migration20260501T123145SearchPhraseRecordsInit',
  'Migration20260501T185834ComparisonsInit',
  'Migration20260501T185835CatalogProductAttributeIsComparable',
  'Migration20260503T141344QuoteRequestsWorkflow',
  'Migration20260503T182812InventoryWorkflow',
  'Migration20260504T125655PriceListsEngine',
  'Migration20260505T060113CatalogAttributeOptionsAndFlags',
  'Migration20260505T074605PromotionsCriteria',
  'Migration20260505T102206AssetsLibraryInit',
  'Migration20260505T130214CmsInit',
  'Migration20260505T193836MegamenuInit',
  'Migration20260506T081055BlogInit',
  'Migration20260506T112634DictionariesDictionaryInit',
  'Migration20260506T200657CoreModuleLifecycleInit',
  'Migration20260507T091405I18nAdminI18nInit',
  'Migration20260507T142354AdminActionsInit',
  'Migration20260514T111329CoreSettingsGlobalValue',
  'Migration20260515T082629CatalogAttributeMassEditable',
  'Migration20260526T124736CatalogProductStatusInactive',
  'Migration20260611T140346CatalogProductValueOverridesInit',
  'Migration20260611T140347InventoryWarehouseDefaultLowStockThreshold',
  'Migration20260611T140348InventoryPerWarehouseLowStockThresholds',
  'Migration20260611T140349OrganizationsConsolidation',
  'Migration20260611T140350AdminNotificationsInit',
  'Migration20260611T140351CustomerAccountsOrganizationOptional',
  'Migration20260611T140352CartsConsolidation',
  'Migration20260611T140353PaymentMethodsAdapter',
  'Migration20260611T140354DeliveryMethodsShippingMethodsAdapterAndShipments',
  'Migration20260611T140355OrdersBusinessId',
  'Migration20260611T140356OrdersStatusModel',
  'Migration20260611T140357OrdersOrderCommentsAndSavedViews',
  'Migration20260611T140358OrganizationsOrgOrderConfirmationEmails',
  'Migration20260611T140359QuickOrderDefaultPreferences',
  'Migration20260611T140400CatalogAttributeQuickSearchable',
  'Migration20260611T140401OrdersOrderStatusDefaultName',
  'Migration20260611T140402OrganizationsOrgFulfilmentStrategy',
  'Migration20260611T140403CustomerAccountsLifecycle',
  'Migration20260611T140404CustomersCustomerAddressesInit',
  'Migration20260611T140405OrdersOrderStatusColor',
  'Migration20260611T140406OrdersOrderSavedViewColumns',
  'Migration20260611T140407CatalogBulkOperations',
  'Migration20260611T140408CatalogBulkOperationLogs',
  'Migration20260611T140409MfaInit',
  'Migration20260611T140410PromptActionsInit',
  'Migration20260611T140411CoreSettingsSecretValueType',
  'Migration20260611T140412CatalogProductPackagingUnits',
  'Migration20260611T140413CartsCartItemPackaging',
  'Migration20260611T140414OrdersOrderItemPackaging',
  'Migration20260611T140415QuoteRequestsQrItemPackaging',
  'Migration20260611T140416DeliveryMethodsFixInPersonPickupAdapter',
  'Migration20260611T140417QuoteRequestsBusinessId',
  'Migration20260611T140418ShoppingListsDefault',
  'Migration20260611T140419CoreSettingsEnumOptions',
  'Migration20260617T095510QuoteRequestsBackfillAdminCreatedAwaiting',
  'Migration20260618T100727PromotionsEngine',
  'Migration20260618T130459OrdersOrderAppliedPromotions',
  'Migration20260625T144227ReturnsInit',
  'Migration20260625T144228PwaInit',
  'Migration20260629T090100CoreSettingsHiddenFlag',
  'Migration20260629T113442TransactionalEmailsInit',
  'Migration20260629T125121InvoicesModule',
  'Migration20260629T200954NewsletterInit',
  'Migration20260708T101135StripeInit',
  'Migration20260715T103358StripePaymentRefundedAmount',
  'Migration20260715T171116GoogleAnalyticsInit',
  'Migration20260717T134752CoreTenantScopeIndexes',
  'Migration20260717T151403OrganizationsPersonalOrganizations',
  'Migration20260718T060659CatalogBulkOperationRevertState',
  'Migration20260718T200338CustomFieldsInit',
  'Migration20260718T200339OrdersOrderCustomFieldValues',
  'Migration20260718T200340OrganizationsOrganizationCustomFieldValues',
  'Migration20260718T200341CustomerAccountsCustomerAccountCustomFieldValues',
  'Migration20260718T200342QuoteRequestsQuoteRequestCustomFieldValues',
  'Migration20260718T200343CatalogCategoryCustomFieldValues',
  'Migration20260720T044254OrganizationsOrgHierarchy',
  'Migration20260720T044255CustomerAccountsCustomerSubtreeRollup',
  'Migration20260721T011509CredentialsInit',
  'Migration20260721T011510CoreSettingsCredentialRefValueType',
  'Migration20260722T224358KsefInit',
  'Migration20260723T230401CatalogAttributesOnCustomFields',
  'Migration20260724T173916ApiKeysDistributorBinding',
  'Migration20260724T193611OrdersOrderPlacementIntents',
  'Migration20260724T203140WebhooksOrgFilter',
  'Migration20260727T200555WebhooksDropExternalIntegrations',
  'Migration20260727T233211LinkedinAdsInit',
  'Migration20260728T002715MetaAdsInit',
  'Migration20260729T132507TpayInit',
  'Migration20260816T203339CoreRetireCoreActivationSettings',
  'Migration20260817T070014EmailDeliveryRecord',
  'Migration20260801T111001TransactionalEmailsEmailDefaultsReseed',
  'Migration20260819T155150AdminUsersFoldEmailCase',
  'Migration20260804T152604CatalogWidenProductSku',
  'Migration20260804T160244CatalogCategoryActivation',
  'Migration20260819T074816CustomerAccountsPasswordSetAt',
  'Migration20260819T142837CustomerAccountsFoldEmailCase',
  'Migration20260817T055457PriceListsSingleSystemPriceList',
  'Migration20260801T111000InvoicesGenericTemplateReseed',
  'Migration20260804T190439PimErgonodeInit',
  'Migration20260817T194652ShipmentsOrderFk',
  'Migration20260817T201110InvoicesCorrectionIdempotencyKey',
  'Migration20260817T201111CreditLimitsReturnTopups',
  'Migration20260817T203206ReturnsRefundCorrectiveInvoiceOutcome',
  'Migration20260801T100943PayuInit',
  'Migration20260803T065409AutopayInit',
  'Migration20260816T053826StripeSeedPaymentMethods',
  'Migration20260816T053830PayuSeedPaymentMethods',
  'Migration20260816T053834TpaySeedPaymentMethods',
  'Migration20260816T053835AutopaySeedPaymentMethods',
  'Migration20260818T081243InventoryStockAllocationOrderItemFk',
  'Migration20260802T073547ProductFeedsInit',
  'Migration20260802T073627ProductFeedsRuns',
  'Migration20260802T110630ProductFeedsTaxonomies',
  'Migration20260803T060153ProductFeedsTaxonomyRefresh',
  'Migration20260804T152741ProductFeedsWidenIssueSku',
  'Migration20260806T105956ProductFeedsFeedTokenSecret',
  'Migration20260806T125806ProductFeedsDelivery',
  'Migration20260818T081251PromotionsPromotionUsageOrderFk',
  'Migration20260818T081252CreditLimitsCreditLimitReservationOrderFk',
  'Migration20260818T081253CartsCartCompletedOrderFk',
  'Migration20260819T171006ShipmentsStatusPendingManual',
];

describe('migration order — the pre-081 baseline (T001)', () => {
  it('emits as many migrations as the baseline records', () => {
    expect(emittedOrder()).toHaveLength(PRE_081_ORDER.length);
    expect(PRE_081_ORDER).toHaveLength(MIGRATION_REGISTRY.length);
  });

  it('emits exactly the baseline\u2019s migrations \u2014 no class was renamed, added or dropped', () => {
    // The property `mikro_orm_migrations` depends on: it keys applied work by
    // class name, so a name in the emitted list that is not in the baseline is
    // a migration that becomes pending again on every live database.
    const emitted = emittedOrder();
    expect(new Set(emitted).size, 'a name is emitted twice').toBe(emitted.length);
    expect([...emitted].sort()).toEqual([...PRE_081_ORDER].sort());
  });

  it('emits the frozen historical prefix identically', () => {
    const emitted = emittedOrder();
    expect(emitted.slice(0, FROZEN_PREFIX_LENGTH)).toEqual(
      PRE_081_ORDER.slice(0, FROZEN_PREFIX_LENGTH),
    );
  });

  it('agrees with the registry about where the frozen prefix ends', () => {
    // FROZEN_PREFIX_LENGTH is hand-written above; this is what says it is not
    // an arbitrary number. Both algorithms put every entry stamped at or
    // before the watermark, and only those, in the prefix.
    const stampOf = (name: string): string =>
      name.slice('Migration'.length, 'Migration'.length + 15);
    const withinWatermark = PRE_081_ORDER.filter((name) => stampOf(name) <= BASELINE_THROUGH);

    expect(withinWatermark).toHaveLength(FROZEN_PREFIX_LENGTH);
    expect(PRE_081_ORDER.slice(0, FROZEN_PREFIX_LENGTH)).toEqual(withinWatermark);
  });

  it('moves exactly the positions the current algorithm is expected to move', () => {
    const emitted = emittedOrder();
    const moved = emitted
      .map((name, index) => (name === PRE_081_ORDER[index] ? null : { index, name }))
      .filter((entry): entry is { index: number; name: string } => entry !== null);

    expect(
      moved.length,
      `positions differing from the pre-081 baseline: ${moved.map((m) => `${m.index}:${m.name}`).join(', ')}`,
    ).toBe(EXPECTED_MOVED_POSITIONS);

    const inFrozenPrefix = moved.filter((entry) => entry.index < FROZEN_PREFIX_LENGTH);
    expect(
      inFrozenPrefix,
      'the frozen prefix is history and may not be reordered by any change',
    ).toEqual([]);
  });
});
