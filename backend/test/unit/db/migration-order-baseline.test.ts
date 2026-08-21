import { describe, expect, it } from 'vitest';
import { BASELINE_THROUGH, orderMigrations } from '../../../src/db/migration-order.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';

/**
 * The frozen historical prefix, committed as a literal.
 *
 * `FROZEN_PREFIX` below is the order in which a database actually applied the
 * pre-065 block, captured on `master@9ecee8fa` — before
 * `src/db/migration-order.ts` was rewritten — and unchanged since. It stays a
 * committed literal and is never regenerated: a baseline recomputed from the
 * code it is supposed to guard measures nothing. That sentence is the reason
 * this file exists, and it is the reason it cannot be replaced by
 * `migration-order.test.ts`'s J14, which derives its expected prefix by
 * filtering today's registry and would therefore follow a change to the
 * registry, a stamp or the watermark wherever it went.
 *
 * The claim: `orderMigrations()` emits these 112 names, in this order, first.
 * That block predates feature 065 — it was written and applied in a
 * hand-maintained array order its manifests do not describe, contradicting it
 * in 37 places — so emitting it any other way produces an order a fresh
 * database cannot apply. It is the claim the live-database safety rests on.
 *
 * **The literal is closed and cannot grow.** Membership is `origin === 'core'`
 * and a stamp at or before `BASELINE_THROUGH` (`20260801T000000`), and
 * `scripts/new-migration.ts` clamps every scaffolded core stamp past that
 * watermark — see `new-migration-scaffolder.test.ts`, "never emits a stamp
 * inside the uncorrected block". So no migration a merge request adds can join
 * it, which is what makes a committed literal affordable here: adding a
 * migration does not touch this file, and two merge requests that each add one
 * do not meet in it.
 *
 * ## What this file used to be, and why that half is retired (issue #291)
 *
 * It shipped as feature 081's T001 regression baseline: the full 065-era
 * emission (`PRE_081_ORDER`, 157 entries by the end) plus
 * `EXPECTED_MOVED_POSITIONS`, a count of the positions on which the rewritten
 * algorithm disagreed with the one it replaced. Its job was to prove that the
 * rewrite did nothing harmful to a live database, and it did that job: the
 * rewrite shipped in `a139e1b7` with the fresh-and-upgrade rehearsal of T002 in
 * its merge request, and every database in the project — each developer's, the
 * `b2b_test_tpl` template and every per-invocation clone taken from it — has
 * been built under the new ordering since. No database holds an applied set
 * that predates the rewrite and has not been re-derived under it. That is the
 * expiry condition, and it is met.
 *
 * The cost of keeping it past that point was measured rather than argued. Every
 * one of the 11 migration-bearing merge requests since `a139e1b7` had to edit
 * this file, because both `PRE_081_ORDER` and the count are **measurements** —
 * 065's `orderMigrations`, taken from `master@a139e1b7^`, re-run over the merged
 * registry — and neither can be resolved textually when two branches carry one.
 * The count did not even move monotonically (26, 28, 29, 30, 30, 29, 36, 36, 39,
 * 41, 41): inserting an entry ahead of an existing one can end a *coincidental*
 * agreement between the two algorithms, so the second branch to land always had
 * to re-measure after the first. Two merge requests (!835, !837) were sent back
 * for exactly that. Migration work was serialised platform-wide, and ruling D-106 — a
 * package ships its own migrations — multiplies migration-bearing changes rather
 * than reducing them.
 *
 * What went with it, stated so that nobody has to rediscover it:
 *
 * - **The moved-position count.** It compared today's code against a function
 *   deleted from `src/` in `a139e1b7`; its one durable sub-claim, that no moved
 *   position falls inside the frozen prefix, is the first test below.
 * - **Rename detection for the 45 open-block classes.** The old set comparison
 *   caught those as a side effect. The 112 frozen names are still covered, by
 *   the two tests below. Renaming an open-block class now surfaces at the next
 *   `db:fresh` or test-template rebuild, where umzug sees the new name as
 *   pending and re-runs it — see `docs/docs/architecture/migrations.md`
 *   § *The baseline block, and renaming an applied migration*, which is where
 *   that rule and its coordinated-rebuild remedy already live.
 * - **The 065 emission as a record.** Recoverable in full from
 *   `git show e3a6a02d:backend/test/unit/db/migration-order-baseline.test.ts`,
 *   the last commit that carried it, and in its original 141-entry form from
 *   `9ecee8fa`. Both hold the prose that named, insertion by insertion, which
 *   positions moved and why.
 *
 * The properties that survived the retirement did not need the literal: the
 * bijection with the registry, per-module contiguity, intra-module chronology,
 * dependency order and the absence of cycles are all asserted over the real
 * registry and the real manifest graph by `migration-order.test.ts` § J14.
 *
 * What is left has no expiry of its own. It retires exactly when
 * `BASELINE_THROUGH` does, and `src/db/migration-order.ts` says of that block:
 * "Closed. Never drained."
 */
const FROZEN_PREFIX: readonly string[] = [
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
];

const MODULE_DEPENDENCIES: ReadonlyMap<string, readonly string[]> = new Map<
  string,
  readonly string[]
>([
  ['core', []],
  ...DISCOVERED_MANIFESTS.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const),
]);

function emittedOrder(): string[] {
  return orderMigrations({
    entries: MIGRATION_REGISTRY,
    moduleDependencies: MODULE_DEPENDENCIES,
    baselineThrough: BASELINE_THROUGH,
  }).migrations.map((migration) => migration.name);
}

/** `Migration20260424T165847CoreFoundationInit` -> `20260424T165847`. */
function stampOf(name: string): string {
  return name.slice('Migration'.length, 'Migration'.length + 15);
}

describe('migration order — the frozen historical prefix', () => {
  it('emits the frozen historical prefix identically', () => {
    // The claim the live-database safety rests on. Compared against a committed
    // literal, never against a prefix recomputed from the registry: the two
    // agree today, and the point of the literal is to be the one that does not
    // move when the registry, a stamp or the watermark does.
    const emitted = emittedOrder().slice(0, FROZEN_PREFIX.length);

    // Reported before the deep equality, because `[ …(112) ] to deeply equal
    // [ …(112) ]` tells the author nothing and this block is 112 entries long.
    const divergence = FROZEN_PREFIX.findIndex((name, index) => emitted[index] !== name);
    expect(
      divergence,
      divergence === -1
        ? ''
        : `position ${divergence} of the frozen prefix holds "${emitted[divergence]}", ` +
            `where history applied "${FROZEN_PREFIX[divergence]}". This block's order is ` +
            `history and a fresh database cannot apply any other; see the file header.`,
    ).toBe(-1);
    expect(emitted).toEqual(FROZEN_PREFIX);
  });

  it('holds every migration the watermark covers, and only those', () => {
    // What makes the literal *complete*: a migration cannot land inside the
    // frozen block without this going red, and neither can one leave it. Order
    // is not the subject here — the test above is — so both sides are sorted.
    const withinWatermark = MIGRATION_REGISTRY.map((entry) => entry.cls.name).filter(
      (name) => stampOf(name) <= BASELINE_THROUGH,
    );
    const pinned = new Set(FROZEN_PREFIX);
    const registered = new Set(withinWatermark);

    // Named rather than counted, for the same reason as above: the two ways
    // this goes red want different remedies. An arrival is a stamp hand-written
    // below the watermark, which the scaffolder cannot produce; a departure is
    // an applied class renamed or deleted, which costs every database a rebuild.
    expect(
      withinWatermark.filter((name) => !pinned.has(name)),
      'a migration entered the frozen block, whose membership closed at BASELINE_THROUGH',
    ).toEqual([]);
    expect(
      FROZEN_PREFIX.filter((name) => !registered.has(name)),
      'a migration left the frozen block — an applied class was renamed or deleted',
    ).toEqual([]);
    expect([...withinWatermark].sort()).toEqual([...FROZEN_PREFIX].sort());
  });

  it('emits nothing stamped inside the watermark after the prefix ends', () => {
    // The boundary, asserted without consulting the literal. Only the committed
    // core registry is walked, so the origin half of the membership rule cannot
    // legitimately push a below-watermark entry into the open block here — the
    // test below is what keeps that true. An external entry doing so on purpose
    // is `migration-order.test.ts` § J11.
    const afterPrefix = emittedOrder().slice(FROZEN_PREFIX.length);
    const leaked = afterPrefix.filter((name) => stampOf(name) <= BASELINE_THROUGH);

    expect(leaked, 'a below-watermark migration is emitted outside the frozen prefix').toEqual([]);
    expect(afterPrefix.length, 'the open block is empty').toBeGreaterThan(0);
  });

  it('carries no committed entry that declares itself external', () => {
    // The second half of baseline membership. A committed entry stamped below
    // the watermark but declared `external` is dropped from the prefix by
    // `isBaseline` while still passing the stamp filter above, so the two tests
    // before this one would disagree about it for a reason neither can name.
    const external = MIGRATION_REGISTRY.filter(
      (entry) => entry.origin !== undefined && entry.origin !== 'core',
    ).map((entry) => entry.cls.name);

    expect(external, 'the committed core registry may only contribute core-origin entries').toEqual(
      [],
    );
  });
});
