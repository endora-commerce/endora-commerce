import type { AssetsLibraryCradle } from '../../src/modules/assets_library/backend.js';
import type { CustomerAccountsCradle } from '../../src/modules/customer_accounts/backend.js';
import type { PaymentAdapterRegistry } from '../../src/modules/payment_methods/services/payment-adapter-registry.js';
import type { OrderStatusRegistry } from '../../src/modules/payment_methods/services/order-status-registry.port.js';
import type { ShippingAdapterRegistry } from '../../src/modules/delivery_methods/services/shipping-adapter-registry.js';
import type { ShippingMethodEligibilityService } from '../../src/modules/delivery_methods/services/shipping-method-eligibility.js';
import { builtInPaymentAdapters } from '../../src/modules/payments/adapters/built-in-adapters.js';
import type { ConfigurationTypeRegistry } from '../../src/modules/credentials/services/configuration-type-registry.js';
import type { CredentialsService } from '../../src/modules/credentials/services/credentials.service.js';
import type { AdminNotificationService } from '../../src/modules/admin_notifications/services/admin-notification-service.js';
import type { CurrencyService } from '../../src/modules/currencies/services/currency-service.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import Redis from 'ioredis';

/**
 * A subscriber-shaped object that subscribes to nothing.
 *
 * Feature 072 (T087) — `custom_fields` arms its definition-invalidation
 * channel from `onBoot`, so every composition now *asks* for a subscriber.
 * Production hands it the real one. The harness hands it this unless the test
 * opted into pub/sub, because a live subscription per composition is the leak
 * the `exercisePubSub` opt-in was measured into existence to stop — and because
 * a module that never receives an invalidation still behaves correctly, it just
 * falls back to the cache's 5 s TTL.
 */
function inertRedisSubscriber(): Redis {
  const inert = {
    subscribe: async () => 0,
    on: () => inert,
    removeAllListeners: () => inert,
    unsubscribe: async () => 0,
    disconnect: () => undefined,
  };
  return inert as unknown as Redis;
}
import { buildServer, type ModulePlugin } from '../../src/http/server.js';
import { ApiInterceptorRegistry } from '../../src/http/interceptors/index.js';
import {
  registerApiInterceptorAdminRoutes,
  registerModulePresenceRoutes,
} from '../../src/modules/_lifecycle/routes.admin.js';
import { registerModulePresenceStorefrontRoutes } from '../../src/modules/_lifecycle/routes.storefront.js';
import {
  publishStateChanged,
  STATE_CHANGED_CHANNEL,
} from '../../src/modules/_lifecycle/services/registry-cache.js';
import { activationDeclarationsFrom } from '../../src/modules/_lifecycle/services/activation-resolver.js';
import { effectiveState } from '../../src/modules/_lifecycle/services/effective-state.js';
import { ModuleDisabledError } from '../../src/modules/_lifecycle/plugin-helpers.js';
import { forkScopedEm } from '../../src/tenancy/scoped-em.js';
import { type TenantContext } from '../../src/tenancy/tenant-context.js';
import { registerRequestScopeHook } from '../../src/kernel/request-scope-hook.js';
// Feature 072 — the generated module list, walked in the same two passes the
// production root walks it in (`src/composition-passes.ts`).
import { MODULES } from '../../src/composition.generated.js';
import { earlyPassModules, latePassModules } from '../../src/composition-passes.js';
import {
  composeModules,
  createRegistrationOwnership,
  createRootContainer,
  registerOrm,
  registerValues,
  type KernelContainer,
} from '../../src/kernel/index.js';
import {
  resolveTenantContext,
  systemTenantContext,
} from '../../src/tenancy/resolve-tenant-context.js';
import { initOrm, closeOrm } from '../../src/db/index.js';
import { EventBus } from '../../src/events/bus.js';
import { CommandBus } from '../../src/commands/index.js';
import type { SessionService } from '../../src/modules/auth/services/session-service.js';
import { AuditLogService } from '../../src/kernel/audit/audit-log-service.js';
import type { PermissionService } from '../../src/modules/admin_roles/services/permission-service.js';
import type { PermissionCatalogueService } from '../../src/modules/admin_roles/services/permission-catalogue.service.js';
import type { AdminRoleService } from '../../src/modules/admin_roles/services/admin-role-service.js';
import type { AuthCradle } from '../../src/modules/auth/backend.js';
import { REGISTERED_MANIFESTS } from '../../src/modules/_lifecycle/registered-manifests.js';
import { registryCache } from '../../src/modules/_lifecycle/services/registry-cache.js';
import { catalogModule } from '../../src/modules/catalog/plugin.js';
import { quoteRequestsModule } from '../../src/modules/quote_requests/plugin.js';
import { customersModule } from '../../src/modules/customers/plugin.js';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../src/http/error-envelope.js';
import { randomUUID } from 'node:crypto';
import { CustomerAccount } from '../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { AdminUser } from '../../src/modules/admin_users/entities/admin-user.entity.js';
import type { AdminI18nCradle } from '../../src/modules/_i18n/backend.js';
import { adminActionsModule } from '../../src/modules/admin_actions/plugin.js';
import { AdminRole } from '../../src/modules/admin_roles/entities/admin-role.entity.js';
import { organizationsModule } from '../../src/modules/organizations/plugin.js';
import { Organization } from '../../src/modules/organizations/entities/organization.entity.js';
import { OrganizationModerationService } from '../../src/modules/organizations/services/organization-moderation-service.js';
import { OrganizationContextService } from '../../src/modules/organizations/services/organization-context-service.js';
import { OrganizationRestrictionService } from '../../src/modules/organizations/services/organization-restriction-service.js';
import { SalesRepAssignmentService } from '../../src/modules/organizations/services/sales-rep-assignment-service.js';
import { OrganizationTreeService } from '../../src/modules/organizations/services/organization-tree-service.js';
import { OrganizationInheritanceService } from '../../src/modules/organizations/services/organization-inheritance-service.js';
import type { AddressService } from '../../src/modules/addresses/services/address-service.js';
import { ORGANIZATIONS_SETTING_CODES } from '../../src/modules/organizations/manifest.js';
import { resolveCustomerRollupSubtreeIds } from '../../src/modules/customer_accounts/services/customer-rollup-scope.js';
import { OrganizationEffectivePriceListsService } from '../../src/modules/organizations/services/organization-effective-pricelists-service.js';
import { OrganizationTaxIdValidationService } from '../../src/modules/organizations/services/organization-tax-id-validation-service.js';
import type {
  VatValidator,
  VatValidationResult,
} from '../../src/modules/organizations/services/vat-validator-port.js';
import { OrgRegistrationNotifier } from '../../src/modules/organizations/services/org-registration-notifier.js';
import type { OrganizationEventBus } from '../../src/modules/organizations/services/registration-service.js';
// Feature 072 (T079) — `email` composes through the kernel here too, from the
// generated list. The five hand-rolled `new ConsoleMailer()` fallbacks this
// replaced were the reason a conversion of `composition.ts` alone would have
// proved nothing: every mail-sending suite runs against this root.
import type { EmailCradle } from '../../src/modules/email/backend.js';
import { commerceModule } from '../../src/modules/orders/plugin.js';
import { adminModule } from '../../src/modules/admin_users/plugin.js';
import { inventoryModule } from '../../src/modules/inventory/plugin.js';
import { StockLevelService } from '../../src/modules/inventory/services/stock-level-service.js';
import { WarehouseChannelService } from '../../src/modules/inventory/services/warehouse-channel-service.js';
import { shoppingListsModule } from '../../src/modules/shopping_lists/plugin.js';
import { returnsModule } from '../../src/modules/returns/plugin.js';
import { invoicesModule } from '../../src/modules/invoices/plugin.js';
import { transactionalEmailsModule } from '../../src/modules/transactional_emails/plugin.js';
import { emailDefaultsRegistry } from '../../src/modules/transactional_emails/services/email-defaults-registry.js';
import { newsletterModule } from '../../src/modules/newsletter/plugin.js';
import { ORDER_CONFIRMATION_DEFAULT } from '../../src/modules/orders/email-templates/order-confirmation.default.js';
import {
  ORDER_COMMENT_DEFAULT,
  REORDER_CREATED_DEFAULT,
  ADMIN_CREATED_ORDER_DEFAULT,
} from '../../src/modules/orders/email-templates/secondary-defaults.js';
import {
  RETURN_AUTHORIZED_DEFAULT,
  RETURN_REJECTED_DEFAULT,
} from '../../src/modules/returns/email-templates/transactional-defaults.js';
import {
  EMAIL_VERIFICATION_DEFAULT,
  ORGANIZATION_INVITATION_DEFAULT,
  NEW_ORG_REGISTRATION_DEFAULT,
} from '../../src/modules/organizations/email-templates/transactional-defaults.js';
import { makeOrgTemplateEmail } from '../../src/modules/organizations/services/org-template-email.js';
import {
  LOW_STOCK_ALERT_DEFAULT,
  AVAILABILITY_BACK_IN_STOCK_DEFAULT,
} from '../../src/modules/inventory/email-templates/transactional-defaults.js';
import { PAYMENT_STATUS_CHANGED_DEFAULT } from '../../src/modules/payments/email-templates/transactional-defaults.js';
import { SHIPMENT_CREATED_DEFAULT } from '../../src/modules/shipments/email-templates/transactional-defaults.js';
import { PaymentEmailNotifier } from '../../src/modules/payments/services/payment-email-notifier.js';
import { ShipmentEmailNotifier } from '../../src/modules/shipments/services/shipment-email-notifier.js';
import { OrderReturnContextProvider } from '../../src/modules/orders/services/order-return-context.js';
import { PaymentRefundProvider } from '../../src/modules/payments/services/payment-refund.js';
import { CorrectiveInvoiceProvider } from '../../src/modules/invoices/services/corrective-invoice.js';
import {
  InvoiceNumberGenerator,
  createSettingsPatternResolver,
} from '../../src/modules/invoices/services/invoice-number-generator.js';
import { CreditTopupProvider } from '../../src/modules/credit_limits/services/credit-topup.js';
import { ReturnEmailNotifier } from '../../src/modules/returns/services/return-email-notifier.js';
import type { CreditLimitsCradle } from '../../src/modules/credit_limits/backend.js';
import type { CustomFieldsCradle } from '../../src/modules/custom_fields/backend.js';
import type { CustomFieldDefinitionService } from '../../src/modules/custom_fields/services/custom-field-definition.service.js';
import type { CustomFieldValueService } from '../../src/modules/custom_fields/services/custom-field-value.service.js';
import type { CustomFieldDefinitionsCache } from '../../src/modules/custom_fields/services/custom-field-definitions-cache.js';
import type { ApiKeysCradle } from '../../src/modules/api_keys/backend.js';
import type { LanguagesCradle } from '../../src/modules/languages/backend.js';
import type { CmsCradle } from '../../src/modules/cms/backend.js';
import type { MegamenuCradle } from '../../src/modules/megamenu/backend.js';
import type { TargetValidatorDeps } from '../../src/modules/megamenu/services/target-validator.js';
import type { StorefrontDeps } from '../../src/modules/megamenu/services/storefront-resolver.js';
import { registerMegamenuAssetReferences } from '../../src/modules/megamenu/services/asset-references.js';
import { registerMegamenuCmsReferences } from '../../src/modules/megamenu/services/cms-references.js';
// Feature 072 — the harness is a second composition root, so a module left
// hand-wired here would keep passing against wiring nobody changed. It composes
// the same generated list production does; only the host values differ.
import type { BlogCradle } from '../../src/modules/blog/backend.js';
import type { DictionariesCradle } from '../../src/modules/dictionaries/backend.js';
import { priceListsModule } from '../../src/modules/price_lists/plugin.js';
import type { TaxesCradle } from '../../src/modules/taxes/backend.js';
import type { PromotionsCradle } from '../../src/modules/promotions/backend.js';
import { settingsModule } from '../../src/modules/settings/plugin.js';
import type { MfaActorBridge, MfaCradle } from '../../src/modules/mfa/backend.js';
import { hashPassword } from '../../src/modules/auth/services/password-hasher.js';
import type { MfaLoginPort } from '../../src/modules/auth/services/mfa-login-port.js';
import type { OAuthProviderPort } from '../../src/modules/mfa/services/oauth-provider-service.js';
import { salesChannelsModule } from '../../src/modules/sales_channels/plugin.js';
import { searchModule } from '../../src/modules/search/plugin.js';
import { createSuggestionPricingEnricher } from '../../src/modules/search/services/suggestion-pricing-enricher.js';
import type { PromptActionsCradle } from '../../src/modules/prompt_actions/backend.js';
import type { PromptActionToolRegistry } from '../../src/modules/prompt_actions/services/tool-registry.js';
import type { PromptRequestService } from '../../src/modules/prompt_actions/services/prompt-request.service.js';
import type { LlmProviderFactory } from '../../src/modules/prompt_actions/services/llm/provider-factory.js';
import type { FetchLike } from '../../src/modules/prompt_actions/services/llm/provider.js';
import { ksefModule } from '../../src/modules/ksef/plugin.js';
import { productFeedsModule } from '../../src/modules/product_feeds/plugin.js';
import type {
  TaxonomyFetchResult,
  TaxonomySourceFetcherPort,
} from '../../src/modules/product_feeds/services/taxonomy-source-fetcher.interface.js';
import { feedDeliveryConfigurationType } from '../../src/modules/product_feeds/services/delivery/delivery-credential.type.js';
import {
  FeedDeliveryError,
  type FeedDeliveryAdapter,
} from '../../src/modules/product_feeds/services/delivery/delivery-adapter.interface.js';
import type { FeedDeliveryProtocol } from '@b2b/contracts';
import { pimErgonodeModule } from '../../src/modules/pim_ergonode/plugin.js';
import type { ErgonodeClientPort } from '../../src/modules/pim_ergonode/services/ergonode-client.port.js';
import { ergonodeConfigurationType } from '../../src/modules/pim_ergonode/services/ergonode-credential.type.js';
import type { ErgonodeMediaFetcherPort } from '../../src/modules/pim_ergonode/services/ergonode-media-fetcher.js';
import { refusingErgonodeClient } from './scripted-ergonode-client.js';
import { ScriptedErgonodeMediaFetcher } from './scripted-ergonode-media-fetcher.js';
import { Asset } from '../../src/modules/assets_library/entities/asset.entity.js';
import type { KsefApiClientPort } from '../../src/modules/ksef/integrations/ksef-client.interface.js';
import { configurationTypeRegistry } from '../../src/modules/credentials/services/registry-singleton.js';
import { llmConfigurationType } from '../../src/modules/credentials/types/llm.type.js';
import { emailAdapterConfigurationType } from '../../src/modules/credentials/types/email-adapter.type.js';
import { pwaModule } from '../../src/modules/pwa/plugin.js';
import { SalesChannel } from '../../src/kernel/sales-channels/sales-channel.entity.js';
import { Order } from '../../src/modules/orders/entities/order.entity.js';
import {
  catalogBulkProgressResolver,
  catalogPromptMutationTools,
  catalogPromptResolverTools,
} from '../../src/modules/catalog/prompt-tools.js';
import { inventoryPromptTools } from '../../src/modules/inventory/prompt-tools.js';
import type { ComparisonsCradle } from '../../src/modules/comparisons/backend.js';
import { registerCatalogAssetReferences } from '../../src/modules/catalog/services/asset-references.js';
import { registerCmsAssetReferences } from '../../src/modules/cms/services/asset-references.js';
import { CatalogQueryService } from '../../src/modules/catalog/services/catalog-query.service.js';
import { CatalogAttributeReadService } from '../../src/modules/catalog/services/catalog-attribute-read.service.js';
// Feature 068 — the catalogue write surface the Ergonode connector imports through.
import {
  CatalogAdminService,
  type CatalogEventBus,
} from '../../src/modules/catalog/services/catalog-admin.service.js';
import { CategoryAdminService } from '../../src/modules/catalog/services/category-admin.service.js';
import { AttributeSetService } from '../../src/modules/catalog/services/attribute-set.service.js';
import { GalleryService } from '../../src/modules/catalog/services/gallery.service.js';
import { AttachmentService } from '../../src/modules/catalog/services/attachment.service.js';
import { ProductLinkService } from '../../src/modules/catalog/services/product-link.service.js';
import { GroupedService } from '../../src/modules/catalog/services/grouped.service.js';
import { DefaultChannelReconciler } from '../../src/kernel/sales-channels/default-channel-reconciler.js';
import { ManifestReconciler } from '../../src/kernel/settings/manifest-reconciler.js';
import { collectRegisteredSettingsManifests } from '../../src/modules/settings/services/registered-settings-manifests.js';
import type { CartService } from '../../src/modules/carts/services/cart-service.js';
import type { Mailer } from '../../src/modules/email/services/mailer.js';
import { seedUs1Catalog } from './seed-catalog.js';
import { seedTestOrganizations, TEST_ORGANIZATION_TAX_ID } from './seed-organizations.js';
import { seedUs2Commerce } from './seed-commerce.js';
import { seedTestAdmins } from './seed-admins.js';
import {
  registerTestAuth,
  requireTestAdmin,
  requireTestAdminAny,
  requireTestCustomer,
  TEST_ADMIN_ID,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from './test-actors.js';

export async function setupTestServer(): Promise<FastifyInstance> {
  return buildServer({
    sessionCookieSecret: 'test-secret-do-not-use-in-production',
    openApi: {
      title: 'B2B Platform API (test)',
      version: 'test',
      serverUrl: 'http://localhost',
    },
    disableRateLimit: true,
  });
}

export interface BackendServerOptions {
  seed?: 'us1-catalog' | 'none';
  extraModules?: ModulePlugin[];
  /** When set, injected into `organizationsModule` so tests can assert outbound mail (verification + invitations). */
  organizationsMailer?: Mailer;
  /**
   * Feature 062 — when set, injected into `commerceModule` so tests can assert
   * the order-confirmation e-mail on placement paths (SC-004 parity).
   */
  commerceMailer?: Mailer;
  /** Feature 043 — scripted LLM fetch + clock/TTL seams for prompt-action tests. */
  promptActionsLlmFetch?: FetchLike;
  promptActionsNow?: () => Date;
  promptActionsTtlMinutes?: number;
  /** Feature 059 — stub KSeF API client for submission/credential tests. */
  ksefClientFactory?: (baseUrl: string) => KsefApiClientPort;
  /**
   * Feature 067 Phase 11 — the taxonomy egress transport. Defaults to a stub
   * that FAILS the test if it is ever called, so "no test in this repository
   * reaches the network" is enforced rather than hoped for; the refresh tests
   * pass their own fixture-serving stub.
   */
  taxonomySourceFetcher?: TaxonomySourceFetcherPort;
  /**
   * Feature 070 — the delivery transports. Defaults to adapters that REFUSE
   * every send and every check, for the same reason the taxonomy fetcher does:
   * a code path that starts uploading a priced catalogue to somebody's server
   * without a test opting in has to fail loudly, not quietly succeed.
   */
  feedDeliveryAdapters?: Map<FeedDeliveryProtocol, FeedDeliveryAdapter>;
  /**
   * Feature 068 — the Ergonode source transport. Defaults to a client that
   * THROWS on every stream read, so a test that forgets to script the source
   * fails loudly instead of reaching a customer's PIM; `pim_ergonode` tests pass
   * a `ScriptedErgonodeClient` holding their fixtures.
   */
  ergonodeClient?: ErgonodeClientPort;
  /**
   * Feature 068 / US5 — the byte source for imported media. Defaults to a
   * fetcher that has nothing scripted and therefore answers `not_found`, so a
   * test never opens a socket; the media tests pass a
   * `ScriptedErgonodeMediaFetcher` holding their files.
   */
  ergonodeMediaFetcher?: ErgonodeMediaFetcherPort;
  /**
   * Feature 072 (T073) — arm the cross-process pub/sub path: subscribe the
   * second Redis client to the custom-field and module-state channels.
   *
   * **Off by default, and that is the design, not a shortcut.** Subscribing
   * costs roughly 10 MB per composition and a run performs 555 of them — it
   * added ~1 GB to the suite's live set and pushed it into a heap OOM when it
   * was armed everywhere. Arming it in the handful of tests that actually
   * assert cross-process invalidation exercises the same code and asserts
   * something, which is strictly more than arming it everywhere and asserting
   * nothing.
   */
  exercisePubSub?: boolean;
  /**
   * Feature 060 — contribute API interceptor registrations before the server
   * seals the registry on ready. Contract tests use this to register fixture
   * interceptors against real module endpoints.
   */
  configureInterceptors?: (registry: ApiInterceptorRegistry) => void;
}

export interface BackendServerHandle {
  app: FastifyInstance;
  orm: MikroORM;
  em: () => EntityManager;
  eventBus: EventBus;
  /** Feature 060 — the sealed API interceptor registry (execution plan via `.list()`). */
  apiInterceptors: ApiInterceptorRegistry;
  redis: Redis;
  /** Feature 072 (T073) — the module-state pub/sub client, disconnected at teardown. */
  redisSubscriber: Redis;
  /** Whether `exercisePubSub` armed a subscription, so teardown knows to undo it. */
  pubSubArmed: boolean;
  sessionService: SessionService;
  auditLogService: AuditLogService;
  permissionService: PermissionService;
  permissionCatalogueService: PermissionCatalogueService;
  /** Feature 004 — exposes the universal getter and cache invalidator for tests. */
  settings: ReturnType<typeof settingsModule>['handle'];
  /** Feature 043 — prompt assistant handle (registry + request service). */
  promptActions: {
    registry: PromptActionToolRegistry;
    requestService: PromptRequestService;
    providerFactory: LlmProviderFactory;
  };
  /** Feature 058 — credentials handle (config-type registry + service). */
  credentials: { service: CredentialsService; configurationTypeRegistry: ConfigurationTypeRegistry };
  /** Feature 047 — invoices handle (issuance service, PDF renderer, number generator). */
  invoices: ReturnType<typeof invoicesModule>['handle'];
  /** Feature 059 — KSeF handle (settings, auth, credentials, submissions). */
  ksef: ReturnType<typeof ksefModule>['handle'];
  /** Feature 067 — Product Feed handle (feeds, generation, runs, token cache). */
  productFeeds: ReturnType<typeof productFeedsModule>['handle'];
  /** Feature 068 — Ergonode PIM handle (source client seam, queue gate). */
  pimErgonode: ReturnType<typeof pimErgonodeModule>['handle'];
  /** Feature 046 — PWA handle (config resolver, push services, delivery queue). */
  pwa: ReturnType<typeof pwaModule>['handle'];
  /** Feature 005 — exposes the resolver, membership service, and CRUD service. */
  salesChannels: ReturnType<typeof salesChannelsModule>['handle'];
  /** Feature 062 — api-keys/webhooks handle (api-key gates). */
  integrations: {
    apiKeyService: ApiKeysCradle['apiKeyService'];
    requireApiKey: ApiKeysCradle['requireApiKey'];
    requireBoundApiKey: ApiKeysCradle['requireBoundApiKey'];
  };
  /** Feature 006 — exposes the indexer + suggest service for tests that
   *  want deterministic teardown or to exercise embedder attach/detach. */
  search: ReturnType<typeof searchModule>['handle'];
  /** Feature 007 — exposes the ComparisonService for tests. */
  comparisons: { comparisonService: ComparisonsCradle['comparisonService'] };
  /** Feature 013 — Assets Library handle (service, folders, registry, adapters). */
  assetsLibrary: AssetsLibraryCradle['assetsLibrary']['handle'];
  /** Feature 014 — CMS module handle (page builder registry, services, resolver). */
  cms: CmsCradle['cms']['handle'];
  /** Feature 015 — Megamenu module handle (reference registry, cache). */
  megamenu: {
    referenceRegistry: MegamenuCradle['megamenuReferenceRegistry'];
    cache: MegamenuCradle['megamenuServices']['cache'];
  };
  /**
   * Feature 016 — Blog services, resolved out of the kernel container (feature
   * 072). Not a module handle any more: `blog` declares itself through
   * `registerModule`, so this is a projection of the container for the tests
   * that reach past HTTP.
   */
  blog: {
    cache: BlogCradle['blogCacheService'];
    storefrontResolver: BlogCradle['blogStorefrontResolver'];
  };
  /** Feature 072 — the composed kernel container, disposed at teardown. */
  container: KernelContainer;
  /** Feature 017 — Dictionary module handle (cache + future validator). */
  dictionaries: {
    validator: DictionariesCradle['dictionaryValidator'];
    cache: DictionariesCradle['dictionaryCache'];
  };
  /** Feature 021 — error-envelope i18n bridge. */
  adminI18n: { i18nService: AdminI18nCradle['adminI18nService'] };
  /** Feature 015+ — promotions module handle (exposes PromotionService). */
  promotions: {
    promotionService: PromotionsCradle['promotionService'];
    couponService: PromotionsCradle['promotionCouponService'];
    ruleStore: PromotionsCradle['promotionRuleStore'];
    statsService: PromotionsCradle['promotionStatsService'];
  };
  /** Feature 055 — custom fields (definition + value services). */
  customFields: {
    definitionService: CustomFieldDefinitionService;
    valueService: CustomFieldValueService;
    cache: CustomFieldDefinitionsCache;
  };
  /** Feature 061 — the composed attribute read model (definition + extension views). */
  catalogAttributeRead: CatalogAttributeReadService;
  /** Feature 026 — moderation lifecycle, admin notifications, org context. */
  organizations: {
    moderationService: OrganizationModerationService;
    adminNotificationService: AdminNotificationService;
    organizationContextService: OrganizationContextService;
    /** Feature 026 US4 — per-org allow-list service. */
    restrictionService: OrganizationRestrictionService;
  };
  /**
   * Feature 037 — direct handle on the CartService for tests that exercise
   * `mergeAnonymousIntoCustomer` without going through the login route.
   * Available once the commerce module finishes wiring (after `setupBackendServer`).
   */
  cartService: () => CartService | null;
}

/**
 * Feature 042 US4/US5 — deterministic fake OIDC provider for tests. The
 * resolved email is the `code` query value; `unverified@example.com` → an
 * unverified email. The authorization URL echoes `state` so callback tests can
 * read it from the redirect Location.
 */
const fakeOAuthProvider: OAuthProviderPort = {
  isEnabled: () => true,
  buildAuthorizationUrl: async (provider, { state }) =>
    `https://oauth.test/${provider}/authorize?state=${encodeURIComponent(state)}`,
  exchangeCode: async (provider, { code }) => ({
    provider,
    sub: `sub-${code}`,
    email: code,
    emailVerified: code !== 'unverified@example.com',
  }),
};

/**
 * The default taxonomy egress transport for tests: one that cannot reach
 * anything (feature 067 Phase 11, FR-087).
 *
 * A test that really called Google would be a flake, a privacy leak and a
 * dependency on CI having outbound internet. So the shared harness hands the
 * module a fetcher that refuses every request the same way an air-gapped
 * installation's network would, and the refresh tests inject their own stub
 * serving fixtures. This is the transport half of the same precaution that
 * points `taxonomyDataRoot` at a path which does not exist.
 */
function refusingTaxonomyFetcher(): TaxonomySourceFetcherPort {
  return {
    async fetchFile(): Promise<TaxonomyFetchResult> {
      return {
        ok: false,
        outcome: 'failed',
        reason: 'transport',
        detail: 'No taxonomy egress is configured in the test harness.',
        httpStatus: null,
        bytesRead: null,
      };
    },
  };
}

/**
 * Feature 070 — the delivery transport half of the same precaution.
 *
 * Every adapter refuses, with a reason that names the harness rather than a
 * network condition, so a test that reaches a transport without scripting one
 * reads as a configuration mistake instead of as a flaky partner server.
 */
function refusingDeliveryAdapters(): Map<FeedDeliveryProtocol, FeedDeliveryAdapter> {
  const refuse = (protocol: FeedDeliveryProtocol): FeedDeliveryAdapter => ({
    protocol,
    async send(): Promise<void> {
      throw new FeedDeliveryError(
        'connection_failed',
        'No delivery transport is configured in the test harness.',
      );
    },
    async check(): Promise<void> {
      throw new FeedDeliveryError(
        'connection_failed',
        'No delivery transport is configured in the test harness.',
      );
    },
  });
  return new Map<FeedDeliveryProtocol, FeedDeliveryAdapter>([
    ['sftp', refuse('sftp')],
    ['ftp', refuse('ftp')],
    ['http', refuse('http')],
  ]);
}

function hashTestPassword(): Promise<string> {
  return hashPassword('social-login-no-password-placeholder');
}

/** Pick a display label from a possibly-multilingual (jsonb) name value. */
function testAnyLabel(name: unknown): string {
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object') {
    const values = Object.values(name as Record<string, string>);
    return values[0] ?? '';
  }
  return '';
}

const SEEDED_TABLES = [
  // Feature 068 — Ergonode PIM. Truncated explicitly because nothing cascades
  // here: `ergonode_product_links` hangs off products, but the connection, its
  // cursors, mappings, runs and issues have no path from any table below, so
  // without this a connection created by one test file is still enabled for the
  // next one. Listed children-first for a deterministic cascade.
  'ergonode_import_issues',
  'ergonode_field_protections',
  'ergonode_media_links',
  'ergonode_product_links',
  'ergonode_price_bindings',
  'ergonode_category_mappings',
  'ergonode_attribute_mappings',
  'ergonode_stream_cursors',
  // Both run tables reference each other (`current_run_id` / `connection_id`),
  // so they truncate together in one statement — which is what `truncate ... ,
  // ... cascade` already does.
  'ergonode_import_runs',
  'ergonode_connections',
  // Feature 058 — credentials. Platform-global; truncate so each test starts clean.
  'credential_configurations',
  // Feature 055 — custom fields. Options cascade from definitions.
  'custom_field_options',
  'custom_field_definitions',
  // Feature 042 — MFA. Recovery codes cascade from enrolments.
  'mfa_recovery_codes',
  'mfa_enrolments',
  'mfa_social_identities',
  'mfa_organization_policies',
  'price_list_assignments',
  'price_list_items',
  'price_lists',
  'customer_groups',
  'taxes',
  'promotions',
  'cms_pages',
  // Feature 016 — blog. Truncate before sales_channels so the scope
  // rows cascade deterministically.
  'blog_post_related_products',
  'blog_post_related_posts',
  'blog_post_tags',
  'blog_post_categories',
  'blog_post_languages',
  'blog_post_sales_channels',
  'blog_posts',
  'blog_category_languages',
  'blog_category_sales_channels',
  'blog_categories',
  'blog_tags',
  // Feature 015 — megamenu. Truncate before sales_channels so the
  // bindings cascade is deterministic.
  'megamenu_bindings',
  'megamenu_items',
  'megamenus',
  'analytics_events',
  'sitemap_cache',
  'seo_meta_overrides',
  'audit_log_entries',
  'ksef_submissions',
  'ksef_credentials',
  'invoices',
  'payments',
  'order_items',
  'orders',
  'cart_items',
  'carts',
  'stock_levels',
  'payment_methods',
  'delivery_methods',
  'organization_invitations',
  'email_verification_tokens',
  'addresses',
  'customer_accounts',
  'admin_users',
  'admin_roles',
  'webhook_deliveries',
  'webhooks',
  'api_keys',
  'credit_limit_reservations',
  'credit_limits',
  'organizations',
  'sales_channel_products',
  'product_assets',
  'product_categories',
  'availability_notifications',
  'product_variants',
  // Feature 002 — bridge tables truncate before products so FK CASCADE
  // cleanup is deterministic per-test.
  'attribute_set_attributes',
  'gallery_item_labels',
  'gallery_items',
  'product_attachments',
  'product_links',
  'bundle_slot_options',
  'bundle_slots',
  'grouped_items',
  'product_attributes',
  // attribute_sets is NOT truncated — its system Default row is created
  // by migration 017 and the contract tests rely on it being present.
  'products',
  'categories',
  'sales_channels',
  'assets',
  'quote_request_items',
  'quote_requests',
  'shopping_list_items',
  'shopping_lists',
  // Feature 006 — search analytics ingest. Append-only; clear between
  // tests so contract assertions ("exactly one row was inserted") are
  // deterministic.
  'search_phrase_records',
];

export async function setupBackendServer(
  options: BackendServerOptions = {},
): Promise<BackendServerHandle> {
  const orm = await initOrm();
  // Feature 050 — mirror the production seam: forks stamp tenant filter params
  // from the ambient TenantContext (established per request by the hook below).
  const em = (): EntityManager => forkScopedEm(orm);

  // Feature 072 — the kernel container, built exactly as `composition.ts` does
  // it, including *not* installing it as the process root (see the note there).
  // `teardownBackendServer` disposes it.
  const container = createRootContainer();
  registerOrm(container, orm);
  const registrationOwnership = createRegistrationOwnership();

  // Feature 060 — API interceptor registry, mirroring composition.ts wiring.
  // Fixture registrations arrive via `options.configureInterceptors`; the
  // registry is sealed (after boot validation) inside app.ready(). Constructed
  // here rather than beside its admin routes because `composeModules` hands it
  // to every module that declares an interceptor, and production builds it
  // early for the same reason.
  const apiInterceptors = new ApiInterceptorRegistry({
    isModuleEnabled: (moduleId) => registryCache.isEnabled(moduleId),
  });

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  // Feature 018 / 072 (T073) — the module-state pub/sub client. ioredis puts a
  // subscribed client into a mode where it will not accept ordinary commands,
  // so production keeps subscriptions on a second connection; a harness with
  // one client cannot exercise that path at all, and the pub/sub channel is the
  // platform's *only* cross-process invalidation mechanism — the EventBus is
  // in-process and the settings cache converges by TTL.
  //
  // It costs one more connection per composition. Redis tolerates that where
  // PostgreSQL would not, and files run sequentially under `singleFork`, so at
  // most a couple are live at once — but it is disconnected in
  // `teardownBackendServer` alongside the main client, because 555 leaked
  // connections is what the ceiling in `harness-parity.test.ts` is about.
  const redisSubscriber = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
  // Each setup truncates + reseeds the DB with fresh random-id rows, so any
  // Redis cache that keys by a STABLE business key (channel code, setting code)
  // but stores the now-deleted row's id goes stale and causes FK violations on
  // the next insert. CI gets an ephemeral Redis per run; a developer's local
  // Redis persists across runs, so we must clear the cross-run-stale namespaces
  // here. (cms/megamenu/blog/dictionaries clear their own caches further down
  // via their module handle's `invalidateAll()`, which also drops the LRU.)
  // `sales-channels:*` covers every cache version (feature 053 bumped it to v2).
  for (const pattern of ['session:*', 'sales-channels:*', 'settings:v1:*']) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(keys);
  }

  const auditLogService = new AuditLogService(em);



  const conn = orm.em.getConnection();
  await conn.execute(`truncate table ${SEEDED_TABLES.map((t) => `"${t}"`).join(', ')} cascade`);
  // Feature 002: keep the system Default Attribute Set, drop everything
  // else so contract tests start from a clean slate. (`attribute_sets`
  // isn't in SEEDED_TABLES because the truncate-cascade would drop the
  // Default seed too.)
  await conn.execute('delete from "attribute_sets" where "is_system" = false');
  // Feature 002 (US3): keep the 4 standard attachment_types seeded by
  // migration 021; drop any custom ones the previous test may have
  // added. attachment_types isn't in SEEDED_TABLES for the same reason
  // as attribute_sets — truncate-cascade would drop the seed.
  await conn.execute(
    `delete from "attachment_types" where "code" not in ('certificate', 'tech_spec', 'product_card', 'pdf')`,
  );

  // Reset the i18n + dictionary config tables to a known state so
  // parallel-running tests don't inherit each other's mutations. We don't
  // truncate them in SEEDED_TABLES because they're configuration, not
  // transactional state.
  await conn.execute('delete from "dictionary_translations"');
  await conn.execute('delete from "language_countries"');
  await conn.execute('delete from "countries"');
  await conn.execute('delete from "languages"');
  await conn.execute('delete from "currencies"');
  await conn.execute(
    `insert into "languages" ("code", "label", "is_default", "is_active", "sort_order", "created_at", "updated_at")
     values ('en-US', 'English (US)', true, true, 0, now(), now()),
            ('pl-PL', 'Polski', false, true, 1, now(), now())`,
  );
  await conn.execute(
    `insert into "currencies" ("code", "label", "symbol", "is_default", "is_active", "sort_order", "created_at", "updated_at")
     values ('PLN', 'Polish zloty', U&'z\\0142', true, true, 0, now(), now()),
            ('EUR', 'Euro', U&'\\20AC', false, true, 1, now(), now())`,
  );

  // Feature 005 — guarantee the system-default Sales Channel exists before
  // any seed runs. Test-server uses 'en-US' / 'PLN' to match the language /
  // currency seed above (production uses the 'en' / 'EUR' fallback).
  await new DefaultChannelReconciler(em, undefined, {
    bootstrapDefaults: { code: 'default', language: 'en-US', currency: 'PLN' },
  }).run();

  if ((options.seed ?? 'us1-catalog') === 'us1-catalog') {
    await seedUs1Catalog(em());
  }
  await seedTestOrganizations(em());
  await seedUs2Commerce(em());
  await seedTestAdmins(em());

  const eventBus = new EventBus();

  // Feature 054 — mirror production: the Command Bus is the audited write path.
  const commandBus = new CommandBus(orm, auditLogService, eventBus);

  // Feature 072 — the early pass of the generated module list, composed exactly
  // as `composition.ts` composes it and at the same point in the boot order:
  // ahead of the hand-wired remainder, which reads what it registers.
  // Feature 072 (T078) — seeded **before** the early pass, not at the end of
  // this function where it used to sit.
  //
  // The enabled set is a precondition for every gated resolution, and a
  // converted module's port is resolved as soon as something asks for it. While
  // no module provided a port the late seeding was invisible; `auth` providing
  // `requireAdmin` turned it into `ModuleDisabledError: Module 'auth' is
  // currently disabled` on a platform where nothing was disabled. The ordering
  // was always wrong; nothing had asked the question early enough to show it.
  registryCache.setActivationDeclarations(
    activationDeclarationsFrom(REGISTERED_MANIFESTS.map((e) => e.manifest)),
  );
  registryCache.__setEnabledForTesting(REGISTERED_MANIFESTS.map((e) => e.manifest.id));

  registerValues(container, {
    redis,
    // Mirrors `composition.ts` — but only when a test asks for pub/sub.
    //
    // A converted module arms its own subscription from `onBoot`, which is
    // right in production and wrong here: one armed subscription per
    // composition, across ~225 files, is how this harness accumulated ~1 GB of
    // retention (task #32). Handing the module an inert subscriber keeps the
    // module's code identical in both compositions and keeps the count of
    // *real* subscriptions at "only where a test asks", which is the property
    // `harness-parity` checks.
    redisSubscriber:
      options.exercisePubSub === true ? redisSubscriber : inertRedisSubscriber(),
    // Modules announce on it; `ctx.subscribe` receives on it. A module that
    // publishes needs it as a registration, not just as a composer option.
    eventBus,
    // The audited write path (Principle XIII). A converted module resolves it
    // like any other platform service.
    commandBus,
    // Mirrors `composition.ts`: the resolved registry the permission catalogue
    // is built from, and the kernel's audit writer.
    resolvedModuleRegistry: REGISTERED_MANIFESTS,
    auditLogService,
  });
  const earlyModules = composeModules(earlyPassModules(MODULES), {
    container,
    eventBus,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    interceptorRegistry: apiInterceptors,
    ownership: registrationOwnership,
  });
  await earlyModules.runBootHooks();
  // Feature 072 (T094) — one `CustomerAuthService` for the composition.
  // `customers` and `organizations` each built their own and the MFA argument
  // differed between them; there is one now, and it can always reach the port.
  const customerAccountsCradle = container.cradle as unknown as CustomerAccountsCradle;

  // Feature 072 (T095/T097) — `payment_methods` and `delivery_methods` own
  // their registries, eligibility services and routes now. `orders` still reads
  // them for placement dispatch and `statusOn*` resolution, so the root hands
  // over the container's instances rather than letting a second set exist.
  const methodsCradle = container.cradle as unknown as {
    paymentAdapterRegistry: PaymentAdapterRegistry;
    shippingAdapterRegistry: ShippingAdapterRegistry;
    paymentOrderStatusRegistry: OrderStatusRegistry;
    shippingOrderStatusRegistry: OrderStatusRegistry;
    shippingMethodEligibility: ShippingMethodEligibilityService;
  };
  // The payment built-ins live in `payments`, so `payment_methods` does not
  // seed them — which module supplies an adapter is a deployment question, and
  // that is this root's job. Idempotent: a provider plugin may have registered
  // into the same instance already.
  for (const adapter of builtInPaymentAdapters()) {
    if (!methodsCradle.paymentAdapterRegistry.isRegistered(adapter.adapterKey)) {
      methodsCradle.paymentAdapterRegistry.register(adapter);
    }
  }

  // Feature 072 (T078) — `auth` owns these. Resolved from the same registration
  // production resolves, which is the whole point of converging the roots: the
  // harness no longer builds its own SessionService.
  const sessionService = (container.cradle as unknown as AuthCradle).sessionService;

  // Feature 072 (wave 1) — `admin_roles` owns these three. Resolved from the
  // same registration production resolves, which is how the roots stop being
  // able to differ: T074 found the harness building AdminRoleService without
  // its audit writer, and a registration cannot be built two ways.
  const rolesCradle = container.cradle as unknown as {
    permissionService: PermissionService;
    permissionCatalogueService: PermissionCatalogueService;
    adminRoleService: AdminRoleService;
  };
  const permissionService = rolesCradle.permissionService;
  const permissionCatalogueService = rolesCradle.permissionCatalogueService;
  const adminRoleService = rolesCradle.adminRoleService;

  // Feature 072 (wave 1) — one `CurrencyService`, where `dictionaries` and
  // `languages` each built their own with different invalidators.
  const currencyService = (container.cradle as unknown as { currencyService: CurrencyService })
    .currencyService;

  // Feature 072 (wave 1) — `admin_notifications` provides this as a port, so a
  // cross-module write answers on its effective state rather than succeeding
  // into a module the operator switched off.
  const adminNotificationService = (
    container.cradle as unknown as { adminNotificationService: AdminNotificationService }
  ).adminNotificationService;
  const requireAdminAny = requireTestAdminAny(permissionService);
  // The enabled-set accessor is wired here rather than with the seeding above,
  // because the catalogue it wires is `admin_roles`' registration and does not
  // exist until the early pass has run.
  permissionCatalogueService.setEnabledModuleIdsAccessor(() => registryCache.enabledIds());

  // The mailer the `email` module registered. `injectedMailer` is the same
  // instance unless a test supplied its own — the one seam that stays, because
  // asserting on sent mail needs a handle on the sender, and the modules that
  // take it are not converted yet.
  const emailMailer = (container.cradle as unknown as EmailCradle).emailMailer;
  const injectedMailer = options.organizationsMailer ?? emailMailer;

  // CartService is exposed by the commerce module so the login handler in
  // organizations can merge anonymous baskets after sign-in.
  let cartService: CartService | null = null;
  let shoppingListServiceRef: import('../../src/modules/shopping_lists/services/shopping-list-service.js').ShoppingListService | null = null;
  // Feature 039 — late-bound OrderService for the quick_order one-click flow.
  let orderServiceForOneClick: import('../../src/modules/orders/services/order-service.js').OrderService | null = null;
  // Feature 040 — late-bound OrderListService for the customers module.
  let orderListServiceForCustomers: import('../../src/modules/orders/services/order-list-service.js').OrderListService | null = null;
  let handleFeature026: BackendServerHandle['organizations'] | null = null;
  // Feature 007 — late-bound comparisons adoption hook. Bound once the
  // comparisons module is constructed below; mirrors composition.ts so the
  // customer login flow adopts an anonymous comparison carried by cookie.
  let comparisonAdoption:
    | ((customerAccountId: string, anonymousToken: string) => Promise<void>)
    | null = null;

  // Feature 026 US4 — restriction service + per-request allow-list resolvers.
  // Mirrors the composition.ts pattern: production wiring reads
  // `request.actor`; the test harness uses `request.testActor`.
  const sharedRestrictionService = new OrganizationRestrictionService(em, auditLogService);
  const sharedSalesRepAssignment = new SalesRepAssignmentService(em, auditLogService);
  const buildOrgAllowListResolver = (
    kind: 'paymentMethodIds' | 'deliveryMethodIds' | 'warehouseIds',
  ) => async (request: FastifyRequest): Promise<string[] | null> => {
    const r = request as FastifyRequest & {
      testActor?: { kind: string; organizationId?: string | null };
      actor?: { kind: string; organizationId?: string | null };
    };
    const orgId =
      (r.testActor?.kind === 'customer' && r.testActor.organizationId) ||
      (r.actor?.kind === 'customer' && r.actor.organizationId) ||
      null;
    if (!orgId) return null;
    try {
      const lists = await sharedRestrictionService.readAllowLists(orgId);
      return lists[kind];
    } catch {
      return null;
    }
  };
  const resolveOrganizationPaymentMethodAllowList = buildOrgAllowListResolver('paymentMethodIds');
  const resolveOrganizationDeliveryMethodAllowList = buildOrgAllowListResolver('deliveryMethodIds');
  // Contributed to the two method modules, which default them absent: the
  // per-Organization allow-list is `organizations`' knowledge. Registered here,
  // after the early pass, so it overrides the modules' defaults rather than
  // being overwritten by them.
  registerValues(container, {
    organizationPaymentMethodAllowList: resolveOrganizationPaymentMethodAllowList,
    organizationDeliveryMethodAllowList: resolveOrganizationDeliveryMethodAllowList,
  });
  const resolveOrganizationWarehouseAllowList = buildOrgAllowListResolver('warehouseIds');

  /**
   * Feature 026 US6 — admin orders/RFQ scope for the test harness. Mirrors
   * the composition.ts resolver but reads `request.testActor` (the test
   * harness's decoration).
   */
  const resolveTestAdminOrdersScope = async (
    request: FastifyRequest,
  ): Promise<{ allowAll: true } | { allowAll: false; allowedOrganizationIds: string[] }> => {
    const actor = request.testActor;
    if (!actor || actor.kind !== 'admin') return { allowAll: true };
    const knex = em().getKnex();
    const roleRow = (await knex.raw(
      `select ar."code" as code from "admin_users" au left join "admin_roles" ar on ar."id" = au."admin_role_id" where au."id" = ?`,
      [actor.adminUserId],
    )) as { rows: Array<{ code: string | null }> };
    const roleCode = roleRow.rows[0]?.code ?? null;
    if (roleCode !== 'sales_representative') return { allowAll: true };
    const assignments = (await knex.raw(
      `select "organization_id" from "organization_sales_rep_assignments" where "admin_user_id" = ?`,
      [actor.adminUserId],
    )) as { rows: Array<{ organization_id: string }> };
    return {
      allowAll: false,
      allowedOrganizationIds: assignments.rows.map((r) => r.organization_id),
    };
  };

  // Feature 042 — late-bound MFA login port (the MFA module is built after
  // `settings` below; mirrors composition.ts).
  let testMfaLoginPort: MfaLoginPort | undefined;
  const getTestMfaLoginPort = (): MfaLoginPort | undefined => testMfaLoginPort;

  // Feature 072 (T094) — contributed to `customer_accounts`, which defaults it
  // absent. Registered after the early pass so it overrides the module's own
  // default rather than being overwritten by it; the getter is late-bound, so
  // `mfa` composing later is not a race.
  registerValues(container, { mfaLoginPortGetter: getTestMfaLoginPort });

  // Build the admin module first so we can hand its handle (auditLogService,
  // permissionService) to other modules that need it.
  const admin = adminModule({
    emFactory: em,
    sessionService,
    auditLogService,
    permissionService,
    permissionCatalogueService,
    adminRoleService,
    requireAdmin: requireTestAdmin(permissionService),
    resolveAdminContext: (request) => ({
      adminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
    getMfaLoginPort: getTestMfaLoginPort,
  });

  // Feature 056 — organization tree + inheritance resolution, built here for
  // the same reason production builds it (`composition.ts`): three consumers
  // read it, and without it all three run a shape no deployment runs.
  //
  // The credit-mode closure reads Settings at **call** time, so it may be
  // written before the settings module exists further down — which is exactly
  // how production orders it. Feature 072 (T072).
  const organizationInheritanceService = new OrganizationInheritanceService(
    em,
    new OrganizationTreeService(em),
    async () => {
      try {
        const { z } = await import('zod');
        return await settings.handle.settingsService.get(
          ORGANIZATIONS_SETTING_CODES.CREDIT_INHERITANCE_MODE,
          'default',
          z.enum(['shared_pool', 'independent_default']),
        );
      } catch {
        return 'shared_pool';
      }
    },
  );

  // Credit-limits module — its CreditLimitService is the driver passed into
  // commerceModule below so OrderService.placeOrder can reserve atomically.
  // Feature 072 (T101) — `credit_limits` owns its service and routes now.
  const creditLimitsCradle = container.cradle as unknown as CreditLimitsCradle;

  // Feature 055 — Custom Fields Layer, converted in feature 072 (T087). The
  // module owns its services and its cache subscription now; the harness reads
  // the two ports host modules consume, exactly as `composition.ts` does.
  //
  // The subscription is no longer conditional on `exercisePubSub`. That flag
  // existed because a fire-and-forget `subscribe` could land after teardown and
  // make ioredis reconnect, pinning the composition; the module arms it from an
  // **awaited** `onBoot` during setup instead, so there is no late landing to
  // guard against, and it adds no connection — `redisSubscriber` is one the
  // harness already opens.
  const customFieldsCradle = container.cradle as unknown as CustomFieldsCradle;
  const customFieldDefinitionService = customFieldsCradle.customFieldDefinitionService;
  const customFieldValueService = customFieldsCradle.customFieldValueService;

  // Feature 061 — the composed attribute read model (mirrors composition.ts):
  // product-host custom-field definitions + catalog extension rows, threaded
  // into catalog, search, quick_order, and comparisons.
  const catalogAttributeReadService = new CatalogAttributeReadService(
    em,
    customFieldDefinitionService,
  );

  // US7 — API keys + webhooks. The handle exposes
  // requireApiKey, threaded into the catalog module's by-sku route so that
  // surface gets real bearer-token gating.
  // Feature 072 (T100) — `api_keys` owns its service, its two gates and its
  // routes now, and provides `apiKeyResolver` itself.
  const apiKeysCradle = container.cradle as unknown as ApiKeysCradle;

  // Analytics (Phase 10 / T237). No GA4 forwarder in tests — the env vars
  // are unset by default so `buildForwarderFromEnv` returns a NoopForwarder.

  // Import/Export (Phase 10 / T240).
  // Feature 072 (T122) — `import_export` owns its service and routes now.

  // SEO meta + sitemap (Phase 10 / T235). Stale-window dropped to zero in
  // tests so each test that calls regenerate sees a fresh payload.
  // Feature 072 (T117) — `seo` owns its services and routes now.

  // Languages + currencies (Phase 10 / T238). Static config, bootstrapped
  // by migration 012 with en-US + pl-PL languages and PLN + EUR currencies.
  // Feature 072 (T105) — `languages` owns its services and routes now.
  const languagesCradle = container.cradle as unknown as LanguagesCradle;

  // Feature 072 (T112) — `dictionaries` owns its services, its cache
  // invalidation listeners and its routes now.

  // Registered here rather than with the other host values further down:
  // `addresses` reads it to build the one `AddressService`, and both `orders`
  // and `organizations` are constructed before that block runs.
  // Feature 072 (T090) — one `AddressService` for the whole composition.
  // `orders` and `organizations` used to build their own, and the constructor's
  // validator and audit writer are optional, so the instances were free to
  // disagree — and one did.
  const addressService = (container.cradle as unknown as { addressService: AddressService })
    .addressService;

  // Feature 072 (wave 1) — `dictionaries` reacts to a currency change instead
  // of `currencies` calling into it. The direction matters: declaring the call
  // as a dependency produced a real cycle, and the cycle was the design saying
  // a currency must not know a dictionary cache exists.
  // Feature 072 (T105) — the language half of the same drop. `languages` used
  // to pass a hard-coded `undefined` for its invalidator, so a deactivated
  // language kept validating for up to the validator's 60 s TTL and kept being
  // served from the Redis dictionary cache for up to an hour, while a currency
  // change dropped both immediately.

  // Feature 005 — sales-channels module is built BEFORE every other module
  // that consumes its membership service in their composition (catalog,
  // cms, taxes, promotions, commerce for payment + delivery methods).
  const salesChannels = salesChannelsModule({
    emFactory: em,
    eventBus,
    redis,
    auditLogService,
    requireAdmin: requireTestAdmin(permissionService),
    resolveAdminAuditContext: (request) => ({
      actorAdminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
  });
  // Feature 072 — the kernel-reserved membership port. `payment_methods` and
  // `delivery_methods` resolve it to auto-bind a new method to the system
  // default channel; both are composed early, but they read it when their
  // routes register, which is after this line.
  registerValues(container, {
    salesChannelMembershipPort: salesChannels.handle.membershipService,
  });

  // Feature 014 — CMS module. Reconcile seeded Hooks once; the storefront
  // resolver wraps Redis as a read-through cache.
  // Feature 072 (T093) — `cms` owns its services, resolvers, reconciliation
  // and routes now. Notably it also owns the four late-bound resolvers this
  // harness never wired: the colour-palette writer was absent here, so
  // `PUT /admin/cms/page-builder/color-palette` answered 500 in every test run.
  const cmsCradle = container.cradle as unknown as CmsCradle;
  // Tests rely on writes being immediately visible. Wipe the namespace
  // before each backend boot so a previous run's keys don't bleed in.
  if (cmsCradle.cms.handle.cache) await cmsCradle.cms.handle.cache.invalidateAll();

  // Pricing (T127 / FR-050).
  const priceLists = priceListsModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    // Tests drive the status worker via internal/sweep — keeping the
    // wall-clock interval off avoids spurious DB writes during a run.
    enableStatusSweeper: false,
    // Tests rely on writes being immediately visible — disable the LRU
    // so each contract/integration case sees fresh DB state. Production
    // composition uses the default 60-s TTL.
    pricingCacheTtlMs: 0,
    auditLogService,
    commandBus,
    resolveAdminAuditContext: (request) => ({
      actorAdminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
    // Feature 072 (T072) — without this, inherited price lists (feature 056)
    // resolved flat in every test: a descendant org never picked up an
    // ancestor's org-named list, so the inheritance the feature exists for was
    // exercised by nothing.
    resolveOrgChain: (orgId) => organizationInheritanceService.priceListOrgChain(orgId),
  });

  // Taxes (T128 / FR-051) + Promotions (T129 / FR-052).
  // Feature 072 (T119) — `taxes` owns its service and routes now.
  const taxesCradle = container.cradle as unknown as TaxesCradle;
  // Feature 072 (T115) — `promotions` owns its services and routes now.
  // These three stay here: the org-status gate and the Rule Builder picker
  // sources read `organizations`, `categories`, `payment_methods` and
  // `delivery_methods` directly, and the catalog read port is `catalog`'s.
  // Registered after the late pass, where the module declares its defaults.
  registerValues(container, {
    catalogQueryPort: new CatalogQueryService(em, undefined, undefined, catalogAttributeReadService),
    organizationStatusResolver: async (orgId: string) => {
      const row = (await em().getKnex()
        .raw(`select "status" from "organizations" where "id" = ? and "deleted_at" is null`, [orgId])) as { rows: Array<{ status: string }> };
      return row.rows[0]?.status ?? null;
    },
    promotionRuleTargets: {
      salesChannels: async () => {
        const { items } = await salesChannels.handle.salesChannelsService.list({});
        return items.map((c) => ({ id: c.id, code: c.code, name: testAnyLabel(c.name) }));
      },
      customerGroups: async () => {
        const groups = await priceLists.handle.customerGroupService.list();
        return groups.map((g) => ({ id: g.id, code: g.code, name: g.name }));
      },
      organizations: async () => {
        const res = (await em().getKnex().raw(
          `select "id", "name", "tax_id" from "organizations" where "deleted_at" is null order by "name" asc limit 200`,
        )) as { rows: Array<{ id: string; name: string; tax_id: string | null }> };
        return res.rows.map((r) => ({ id: r.id, name: r.name, taxId: r.tax_id ?? null }));
      },
      categories: async () => {
        const res = (await em().getKnex().raw(
          `select "id", "slug", "name", "parent_category_id" from "categories" where "deleted_at" is null order by "sort_order" asc`,
        )) as { rows: Array<{ id: string; slug: string; name: unknown; parent_category_id: string | null }> };
        return res.rows.map((r) => ({ id: r.id, slug: r.slug, name: testAnyLabel(r.name), parentCategoryId: r.parent_category_id ?? null }));
      },
      paymentMethods: async () => {
        const res = (await em().getKnex().raw(
          `select "id", "code", "name" from "payment_methods" where "status" = 'active' order by "code" asc`,
        )) as { rows: Array<{ id: string; code: string; name: unknown }> };
        return res.rows.map((r) => ({ id: r.id, code: r.code, name: testAnyLabel(r.name) }));
      },
      deliveryMethods: async () => {
        const res = (await em().getKnex().raw(
          `select "id", "code", "name" from "delivery_methods" where "status" = 'active' order by "code" asc`,
        )) as { rows: Array<{ id: string; code: string; name: unknown }> };
        return res.rows.map((r) => ({ id: r.id, code: r.code, name: testAnyLabel(r.name) }));
      },
    },
  });
  const promotionsCradle = container.cradle as unknown as PromotionsCradle;

  // Feature 047 — late-bound transactional-email sender (mirrors composition).
  let transactionalEmailSender: import('@b2b/contracts').TransactionalEmailSender | undefined;

  // Feature 062 — read-only inventory accessors backing the external catalog
  // namespace's availability indication (mirrors composition.ts).
  const externalAvailabilityStockLevels = new StockLevelService(em);
  const externalAvailabilityWarehouseChannels = new WarehouseChannelService(em);

  const modules: ModulePlugin[] = [
    // Feature 072 — the early pass's route contribution, ahead of the auth
    // plugin for the same reason production keeps it there.
    ...earlyModules.sink.plugins,
    // Feature 072 (T078) — `auth`'s root plugin, at the same point in the boot
    // order `composition.ts` puts it: after the liveness probe's routes, before
    // everything that reads `request.actor`.
    //
    // It registers **before** `registerTestAuth`, so its `onRequest` hook runs
    // first and the harness's synthetic actor still wins. That ordering is the
    // whole compatibility story: `auth` decorates `actor` and seeds it from the
    // real session cookies, and `registerTestAuth` then assigns the test actor
    // over the top through the same decorator.
    async (app) => {
      for (const plugin of earlyModules.sink.rootPlugins) await plugin(app);
    },
    async (app) => {
      registerTestAuth(app, {
        sessionService,
        emFactory: em,
        // Feature 062 — mirror production: Bearer sk_live_* resolves to an
        // api_key actor (incl. distributor binding) before the tenant hook
        // and the sales-channel resolver run.
        apiKeyResolver: async (token) => apiKeysCradle.apiKeyService.authenticate(token),
      });
      // Feature 050 — establish the ambient TenantContext from the resolved test
      // actor, after registerTestAuth sets it. Mirrors composition.ts wiring
      // (callback-style so the AsyncLocalStorage store reaches the handler).
      const buildContext = async (request: FastifyRequest): Promise<TenantContext> => {
        const actor = request.testActor;
        if (actor?.kind === 'customer') {
          const orgId =
            actor.organizationId && actor.organizationId.length > 0 ? actor.organizationId : null;
          // Feature 056 (T032) — mirror production: a roll-up-enabled customer
          // widens to its org subtree (server-derived from the account flag).
          const rollupSubtree = await resolveCustomerRollupSubtreeIds(
            em,
            (id) => new OrganizationTreeService(em).subtreeIds(id),
            actor.customerAccountId,
            orgId,
          );
          return resolveTenantContext({
            kind: 'customer',
            customerAccountId: actor.customerAccountId,
            organizationId: orgId,
            impersonatorAdminUserId:
              (actor as { impersonatorAdminUserId?: string | null }).impersonatorAdminUserId ?? null,
            ...(rollupSubtree && rollupSubtree.length > 0
              ? { rollupSubtreeOrganizationIds: rollupSubtree }
              : {}),
          });
        }
        if (actor?.kind === 'admin') {
          const scope = await resolveTestAdminOrdersScope(request);
          return resolveTenantContext({ kind: 'admin', adminUserId: actor.adminUserId }, scope);
        }
        // Feature 062 — mirror production: a bound api key derives single-org
        // scope from its binding; an unbound key keeps trusted system scope.
        if (actor?.kind === 'api_key') {
          return resolveTenantContext({
            kind: 'api_key',
            apiKeyId: actor.apiKeyId,
            organizationId: actor.organizationId ?? null,
            customerAccountId: actor.customerAccountId ?? null,
          });
        }
        return systemTenantContext(`test-actor:${actor?.kind ?? 'anonymous'}`);
      };
      // Feature 072 (T027) — the harness goes through the SAME hook factory as
      // the production composition root. Two hand-written copies is how the
      // request seam gets a leak that no test can see.
      await registerRequestScopeHook(app, { buildTenantContext: buildContext });
    },
    admin.plugin,
    priceLists.plugin,
    commerceModule({
      paymentAdapterRegistry: methodsCradle.paymentAdapterRegistry,
      shippingAdapterRegistry: methodsCradle.shippingAdapterRegistry,
      paymentOrderStatusRegistry: methodsCradle.paymentOrderStatusRegistry,
      shippingOrderStatusRegistry: methodsCradle.shippingOrderStatusRegistry,
      shippingMethodEligibility: methodsCradle.shippingMethodEligibility,
      commandBus,
      emFactory: em,
      eventBus,
      auditLogService,
      customFieldValues: customFieldValueService,
      getTransactionalEmailSender: () => transactionalEmailSender,
      creditLimit: creditLimitsCradle.creditLimitService,
      requireCustomer: requireTestCustomer(),
      requireAdmin: requireTestAdmin(permissionService),
      resolveCustomerContext: customerResolver,
      salesChannelMembership: salesChannels.handle.membershipService,
      // Feature 072 (T072) — production passes this and the harness did not, so
      // every address path in checkout ran a shape no deployment runs. Same
      // three arguments as `composition.ts`.
      addressService,
      // Real per-product VAT — mirrors composition.ts so placeOrder resolves the
      // rate from the tax rules instead of a flat 23%.
      resolveTaxRate: async ({ country, productType, vatStatus }) => {
        try {
          const resolved = await taxesCradle.taxService.taxRateFor({
            country: country ?? 'PL',
            productType: productType as
              | 'simple'
              | 'configurable'
              | 'grouped'
              | 'bundle'
              | 'virtual',
            vatStatus: vatStatus as 'vat_payer' | 'vat_exempt' | 'reverse_charge',
          });
          return resolved.rate;
        } catch {
          return 0.23;
        }
      },
      pricingService: priceLists.handle.pricingService,
      promotionService: promotionsCradle.promotionService,
      redis,
      // Feature 062 — external orders namespace (mirrors composition.ts):
      // bound-key gate + the org method allow-lists (FR-021 envelope).
      requireBoundApiKey: apiKeysCradle.requireBoundApiKey,
      resolveOrganizationMethodAllowLists: async (organizationId: string) => {
        try {
          const lists = await sharedRestrictionService.readAllowLists(organizationId);
          return {
            paymentMethodIds: lists.paymentMethodIds,
            deliveryMethodIds: lists.deliveryMethodIds,
          };
        } catch {
          return null;
        }
      },
      ...(options.commerceMailer ? { mailer: options.commerceMailer } : {}),
      getRfqService: () => quoteRequests?.handle().rfqService ?? null,
      // Global backorder gate — resolved at request time via the Settings
      // module (declared below; the closure runs well after setup completes).
      resolveChannelAllowNegativeStock: async (salesChannelId: string) => {
        try {
          const { z } = await import('zod');
          return await settings.handle.settingsService.get(
            'inventory.allow_negative_stock',
            salesChannelId,
            z.boolean(),
          );
        } catch {
          return false;
        }
      },
      // Feature 039 — expose OrderService for the quick_order one-click flow.
      exposeOrderService: (svc) => {
        orderServiceForOneClick = svc;
      },
      // Feature 040 — expose OrderListService for the customers module.
      exposeOrderListService: (svc) => {
        orderListServiceForCustomers = svc;
      },
      resolveCartActor: (request) => {
        if (request.testActor?.kind === 'customer') {
          return {
            customer: {
              customerAccountId: request.testActor.customerAccountId,
              organizationId: request.testActor.organizationId,
            },
          };
        }
        const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
        const anon = cookies?.['b2b_cart_anon'];
        if (anon) return { anonymousToken: anon };
        return {};
      },
      exposeCartService: (cs) => {
        cartService = cs;
      },
      pushLineToShoppingList: async (input) => {
        if (!shoppingListServiceRef) {
          throw new Error('shopping_lists module not initialized');
        }
        await shoppingListServiceRef.addItem(
          {
            customerAccountId: input.customerAccountId,
            organizationId: input.organizationId ?? '',
          },
          input.shoppingListId,
          {
            productId: input.productId,
            ...(input.variantId ? { variantId: input.variantId } : {}),
            quantity: input.quantity,
          },
        );
      },
      appendShoppingListToCart: async (input) => {
        if (!shoppingListServiceRef) {
          throw new Error('shopping_lists module not initialized');
        }
        const res = await shoppingListServiceRef.convertToCart(
          {
            customerAccountId: input.customerAccountId,
            organizationId: input.organizationId ?? '',
          },
          input.shoppingListId,
          undefined,
        );
        return {
          cartId: '',
          appendedLineCount: res.added,
          droppedLines: res.skipped.map((it) => ({
            productId: it.productId,
            productName: it.productId,
            reason: 'not_purchasable',
          })),
        };
      },
      resolveOrganizationPaymentMethodAllowList,
      resolveOrganizationDeliveryMethodAllowList,
      resolveAdminOrdersScope: resolveTestAdminOrdersScope,
    }),
    // Feature 026 — moderation lifecycle wiring for the test server.
    // Built before organizationsModule so the moderation service can be
    // passed in. Subscribes the registration notifier + auto-approve
    // handler to the same event bus.
    ...(() => {
      const moderationService = new OrganizationModerationService(
        em,
        auditLogService,
        eventBus as unknown as OrganizationEventBus,
        injectedMailer,
        async () => 'manual',
      );
      const resolveScopeSalesChannelId = async (): Promise<string | null> =>
        (await salesChannels.handle.resolver.getSystemDefault())?.id ?? null;
      const resolveSalesChannelLanguage = async (salesChannelId: string): Promise<string> =>
        (await em().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage ?? 'en-US';
      const orgRegistrationNotifier = new OrgRegistrationNotifier({
        emFactory: em,
        adminNotificationService: adminNotificationService,
        mailer: injectedMailer,
        resolveRecipients: async () => [],
        templateEmail: makeOrgTemplateEmail({
          getSender: () => transactionalEmailSender,
          resolveScopeSalesChannelId,
          resolveLanguage: resolveSalesChannelLanguage,
        }),
      });
      eventBus.on('organization.registered.v1', async (payload) => {
        const orgId = (payload as unknown as { organizationId: string }).organizationId;
        await orgRegistrationNotifier.handleRegistered(orgId);
      });
      eventBus.on('organization.registered.v1', async (payload) => {
        const orgId = (payload as unknown as { organizationId: string }).organizationId;
        await moderationService.handleNewlyRegistered(orgId);
      });
      // Reuse the shared service from above so the per-request resolvers and
      // the admin endpoints operate over the same instance.
      const restrictionService = sharedRestrictionService;
      const effectivePriceListsService = new OrganizationEffectivePriceListsService({
        emFactory: em,
        resolveDefaultSalesChannelId: async () => {
          const channel = await salesChannels.handle.resolver.getSystemDefault();
          return channel?.id ?? 'default';
        },
      });
      // Feature 026 US7 — fake VAT validators for the test harness. No
      // real HTTP traffic. The fake returns `validated` for any taxId
      // ending in `00000` (a pure 5-zero suffix) and `failed` / `deferred`
      // otherwise — gives tests three deterministic branches without
      // needing to mock fetch.
      const testTaxIdValidationService = new OrganizationTaxIdValidationService({
        emFactory: em,
        vies: new FakeVatValidator('vies'),
        mfPl: new FakeVatValidator('mf_pl'),
        auditLog: auditLogService,
      });
      // Expose handles on the harness for tests that want to call the
      // services directly.
      handleFeature026 = {
        moderationService,
        adminNotificationService: adminNotificationService,
        organizationContextService: new OrganizationContextService(em),
        restrictionService,
      };
      return [
        organizationsModule({
      customerAuthService: customerAccountsCradle.customerAuthService,
      passwordResetService: customerAccountsCradle.passwordResetService,
      customerRoleService: customerAccountsCradle.customerRoleService,
      totpEnrolmentService: customerAccountsCradle.totpEnrolmentService,
      addressService,
          emFactory: em,
          eventBus,
          commandBus,
          sessionService,
          getMfaLoginPort: getTestMfaLoginPort,
          getTransactionalEmailSender: () => transactionalEmailSender,
          resolveScopeSalesChannelId,
          resolveSalesChannelLanguage,
          requireCustomer: requireTestCustomer(),
          requireAdmin: requireTestAdmin(permissionService),
          requireAdminAny,
          resolveCustomerContext: customerResolver,
          auditLogService,
          moderationService,
          restrictionService,
          effectivePriceListsService,
          taxIdValidationService: testTaxIdValidationService,
          customFieldValues: customFieldValueService,
          exposeTestProbe: true,
                mailer: injectedMailer,
          storefrontBaseUrl: 'http://localhost:3000',
          onLogin: async (ctx) => {
            let result: Record<string, unknown> = {};
            if (cartService && ctx.anonymousCartToken && ctx.organizationId) {
              const cartMerge = await cartService.mergeAnonymousIntoCustomer(
                ctx.anonymousCartToken,
                {
                  customerAccountId: ctx.customerAccountId,
                  organizationId: ctx.organizationId,
                },
              );
              result = { cartMerge };
            }
            // Feature 007 — adopt an anonymous comparison carried by the
            // compare_token cookie. Mirrors composition.ts onLogin.
            if (comparisonAdoption && ctx.anonymousCompareToken) {
              await comparisonAdoption(ctx.customerAccountId, ctx.anonymousCompareToken);
            }
            return result;
          },
        }),
      ];
    })(),
    catalogModule({
      emFactory: em,
      eventBus,
      commandBus,
      requireAdmin: requireTestAdmin(permissionService),
      auditLogService,
      customFieldValues: customFieldValueService,
      customFieldDefinitions: customFieldDefinitionService,
      // Feature 061 — apply seam + composed attribute read model.
      customFieldsPort: customFieldDefinitionService,
      attributeReadService: catalogAttributeReadService,
      requireApiKey: apiKeysCradle.requireApiKey,
      // Feature 062 — external catalog namespace (mirrors composition.ts):
      // bound-key gate + the SAME pricing engine cart pricing uses + the
      // inventory availability port.
      requireBoundApiKey: apiKeysCradle.requireBoundApiKey,
      pricingService: priceLists.handle.pricingService,
      resolveExternalAvailability: async (productIds, salesChannelId) => {
        const candidateWarehouseIds =
          await externalAvailabilityWarehouseChannels.resolveCandidateWarehouseIds(salesChannelId);
        return externalAvailabilityStockLevels.resolveAvailabilityBands(
          productIds,
          candidateWarehouseIds.length > 0 ? candidateWarehouseIds : undefined,
        );
      },
      salesChannelMembership: salesChannels.handle.membershipService,
      languageService: languagesCradle.languageService,
      // Tests assert the queued ack only: no `redis` is wired into the catalog
      // module here, so the producer's enqueue is a no-op and queued rows stay
      // `pending` (no BullMQ worker, no DB churn after a response or across
      // teardown). Stub reindex runner so the `search_reindex` enqueuer is
      // wired (the attribute-searchable flip path); it never hits Meilisearch.
      reindexSearchIndexes: async () => ({ documentCount: 0 }),
      // Storefront product-image placeholder resolver (mirrors composition.ts);
      // `settings` is declared below — the closure runs at request time.
      resolveProductImagePlaceholderUrl: async (salesChannelCode) => {
        try {
          const { z } = await import('zod');
          const channel = salesChannelCode
            ? await salesChannels.handle.resolver.getByCode(salesChannelCode)
            : await salesChannels.handle.resolver.getSystemDefault();
          if (!channel) return null;
          const url = await settings.handle.settingsService.get(
            'product_image_placeholder_url',
            channel.id,
            z.string(),
          );
          const trimmed = url.trim();
          return trimmed === '' ? null : trimmed;
        } catch {
          return null;
        }
      },
      resolveAdminAuditContext: (request) => {
        if (request.testActor?.kind !== 'admin') {
          return { actorAdminUserId: TEST_ADMIN_ID };
        }
        return { actorAdminUserId: request.testActor.adminUserId };
      },
    }),
    inventoryModule({
      emFactory: em,
      requireCustomer: requireTestCustomer(),
      resolveCustomerContext: customerResolver,
      requireAdmin: requireTestAdmin(permissionService),
      templateEmail: makeOrgTemplateEmail({
        getSender: () => transactionalEmailSender,
        resolveScopeSalesChannelId: async () =>
          (await salesChannels.handle.resolver.getSystemDefault())?.id ?? null,
        resolveLanguage: async (id) =>
          (await em().findOne(SalesChannel, { id }))?.defaultLanguage ?? 'en-US',
      }),
        auditLogService,
      resolveAdminAuditContext: (request) => ({
        actorAdminUserId:
          request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
      }),
      resolveOrganizationWarehouseAllowList,
    }),
  ];

  const settings = settingsModule({
    emFactory: em,
    eventBus,
    auditLogService,
    redis,
    requireAdmin: requireTestAdmin(permissionService),
    ...(process.env['SETTINGS_SECRET_ENCRYPTION_KEY']
      ? { secretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] }
      : {}),
    // Feature 073 — mirrors composition.ts: the effective-state reader that
    // classifies each setting and refuses writes an absent module owns.
    modulePresence: {
      presenceOf: (moduleId) => effectiveState.presenceOf(moduleId),
      activationControlOwner: (code) => effectiveState.activationControlOwner(code),
    },
    resolveAdminAuditContext: (request) => ({
      actorAdminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
  });
  // Feature 042 — MFA module (mirrors composition.ts). Built after `settings`
  // so it can read MFA settings; its login port is bound to the late-bound
  // `testMfaLoginPort` captured by the auth services above.
  // Feature 072 (T096) — `mfa` owns its services, routes and configuration.
  // What this harness still owns is the actor shape: it authenticates through
  // `request.testActor` where production uses `request.actor`, which is exactly
  // why the bridge is contributed rather than built into the module.
  registerValues(container, {
    mfaDefaultChannelIdResolver: async () =>
      (await salesChannels.handle.resolver.getSystemDefault())?.id ?? null,
    mfaBaseUrls: {
      backend: 'http://localhost',
      storefront: 'http://localhost:3000',
      admin: 'http://localhost:3002',
    },
    // Feature 042 US4/US5 — deterministic fake provider. `exchangeCode` derives
    // the identity from the `code` query so tests control the resolved email;
    // `unverified@example.com` simulates an unverified provider email.
    mfaOauthProvider: fakeOAuthProvider,
    mfaSocialAccountResolvers: {
      resolveCustomerByEmail: async (email: string) => {
        const c = await em().findOne(CustomerAccount, { email, deletedAt: null });
        return c ? { id: c.id } : null;
      },
      autoCreateCustomer: async (email: string) => {
        const account = em().create(CustomerAccount, {
          email,
          passwordHash: await hashTestPassword(),
          firstName: '',
          lastName: '',
          role: 'regular_user',
          organizationId: null,
          emailVerifiedAt: new Date(),
        });
        await em().persistAndFlush(account);
        return { id: account.id };
      },
      resolveAdminByEmail: async (email: string) => {
        const a = await em().findOne(AdminUser, { email, deletedAt: null, status: 'active' });
        return a ? { id: a.id } : null;
      },
    },
    mfaActorBridge: {
      resolveCustomerActor: (request: FastifyRequest) => {
        if (request.testActor?.kind !== 'customer') {
          throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
        }
        return {
          customerAccountId: request.testActor.customerAccountId,
          organizationId: request.testActor.organizationId ?? null,
        };
      },
      resolveAdminActor: (request: FastifyRequest) => {
        if (request.testActor?.kind !== 'admin') {
          throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
        }
        return { adminUserId: request.testActor.adminUserId };
      },
      resolveOrganizationCustomerIds: async (organizationId: string) => {
        const rows = await em().find(CustomerAccount, { organizationId }, { fields: ['id'] });
        return rows.map((r) => r.id);
      },
      resolveOrgAdmin: async (request: FastifyRequest) => {
        if (request.testActor?.kind !== 'customer') {
          throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
        }
        const c = await em().findOne(CustomerAccount, { id: request.testActor.customerAccountId });
        if (!c || c.role !== 'organization_admin' || !c.organizationId) {
          throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Organization administrator role required.');
        }
        return { organizationId: c.organizationId, actor: c.id };
      },
      // Deliberately omitted, as this harness always omitted them: with no
      // password verifier, disabling 2FA requires a current code. Fail-closed,
      // and the behaviour every MFA test has been written against.
    } satisfies MfaActorBridge,
  });
  const mfaCradle = container.cradle as unknown as MfaCradle;
  testMfaLoginPort = mfaCradle.mfaLoginPort;

  modules.push(salesChannels.plugin);
  modules.push(settings.plugin);

  // Feature 019 — Admin UI i18n. Test wiring uses no lifecycle registry
  // (the boot-time bundle reconciler is skipped), so route-level tests
  // exercise only the HTTP surface and the in-process resolver. Tests
  // that need bundle rows seed the table directly via `h.em()`.
  // Feature 072 (T089) — `_i18n` owns its service, reconciler and routes now.
  const adminI18nCradle = container.cradle as unknown as AdminI18nCradle;

  // Feature 020 — Admin Command Palette actions registry. Mounts the
  // GET /api/v1/admin/admin-actions read endpoint. Tests that need
  // module_actions rows seed them directly via `h.em()`.
  const adminActions = adminActionsModule({
    orm,
    emFactory: em,
    i18nService: adminI18nCradle.adminI18nService,
    permissionService,
    requireAdmin: requireTestAdmin(permissionService),
    resolveAdminContext: (request) => ({
      adminUserId:
        request.testActor?.kind === 'admin'
          ? request.testActor.adminUserId
          : TEST_ADMIN_ID,
    }),
    // Feature 073 — mirrors composition.ts: the palette's operator axis.
    isModuleActivated: (moduleId) =>
      effectiveState.presence(moduleId)?.operatorActivated ?? true,
  });
  modules.push(adminActions.plugin);

  // Feature 058 — Credentials module. Instantiated before the consumer modules
  // (prompt_actions, search, newsletter) so they can receive
  // `credentialsService` for the `credential_ref` resolution path.
  if (!configurationTypeRegistry.isRegistered(llmConfigurationType.code)) {
    configurationTypeRegistry.register(llmConfigurationType);
  }
  if (!configurationTypeRegistry.isRegistered(emailAdapterConfigurationType.code)) {
    configurationTypeRegistry.register(emailAdapterConfigurationType);
  }
  // Feature 068 — this harness MIRRORS `composition.ts` rather than importing
  // it, so a descriptor registered only there is absent for an injected
  // request. Without this line every `pim_ergonode` connection write resolves
  // to an inert configuration type and fails with a misleading error.
  if (!configurationTypeRegistry.isRegistered(ergonodeConfigurationType.code)) {
    configurationTypeRegistry.register(ergonodeConfigurationType);
  }
  // Feature 070 — same reason: without this the delivery configuration's
  // password resolves to an inert type and every write fails misleadingly.
  if (!configurationTypeRegistry.isRegistered(feedDeliveryConfigurationType.code)) {
    configurationTypeRegistry.register(feedDeliveryConfigurationType);
  }
  // Feature 072 (wave 1) — mirrors `composition.ts`: the root supplies the
  // registry and the admin-context resolver, the module owns the service.
  registerValues(container, {
    configurationTypeRegistry,
    adminContextResolver: (request: FastifyRequest) => ({
      adminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
    credentialsSettingsPort: settings.handle.settingsService,
  });
  const credentialsService = (
    container.cradle as unknown as { credentialsService: CredentialsService }
  ).credentialsService;

  // Feature 013 — Assets Library. Routes mount under /api/v1/admin/assets/*
  // and /assets/file/:assetId.
  // Feature 072 (T092) — the module owns its plugin and its registry now; the
  // root only contributes the reference resolvers of whichever modules this
  // deployment ships.
  const assetsLibrary = (container.cradle as unknown as AssetsLibraryCradle).assetsLibrary;
  registerCatalogAssetReferences(assetsLibrary.handle.referenceRegistry, em);
  registerCmsAssetReferences(assetsLibrary.handle.referenceRegistry, em);
  registerMegamenuAssetReferences(assetsLibrary.handle.referenceRegistry, em);

  // Feature 046 — PWA module (mirrors composition.ts). runWorkers:false so no
  // BullMQ consumer starts in tests; the delivery processor is invoked directly
  // by integration tests.
  const pwa = pwaModule({
    emFactory: em,
    redis,
    runWorkers: false,
    settings: settings.handle.settingsService,
    settingsWrite: settings.handle.adminService,
    requireAdmin: requireTestAdmin(permissionService),
    eventBus,
    assetUpload: {
      upload: async (input) => {
        const detail = await assetsLibrary.handle.service.upload(input);
        return { id: detail.id };
      },
    },
    resolveAssetUrl: async (assetId) => {
      try {
        return (await assetsLibrary.handle.service.resolveUrl(assetId)).url;
      } catch {
        return null;
      }
    },
    resolveChannelIdByCode: async (code) => {
      if (code) {
        const ch = await salesChannels.handle.resolver.getByCode(code);
        if (ch) return ch.id;
      }
      return (await salesChannels.handle.resolver.getSystemDefault())?.id ?? 'default';
    },
    defaultChannelId: async () =>
      (await salesChannels.handle.resolver.getSystemDefault())?.id ?? 'default',
    channelCodeForId: async (channelId) => {
      const ch = await em().findOne(SalesChannel, { id: channelId });
      return ch?.code ?? null;
    },
    resolveAuditContext: (request) => ({
      actorAdminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
    vapidSubject: 'mailto:test@b2b-platform.local',
    resolveCustomerAccountId: async (request) =>
      request.testActor?.kind === 'customer' ? request.testActor.customerAccountId : null,
    resolveOrderTarget: async (payload) => {
      const order = await em().findOne(Order, { id: payload.orderId });
      if (!order || !order.placedByCustomerAccountId) return null;
      return {
        salesChannelId: payload.salesChannelId,
        customerAccountId: order.placedByCustomerAccountId,
        title: 'Order update',
        body: `Order ${order.businessId} is now ${payload.to.replace(/_/g, ' ')}.`,
        url: `/account/orders/${order.businessId}`,
      };
    },
  });
  modules.push(pwa.plugin);

  // Feature 015 — Megamenu module. Wires the cross-module ports the
  // target validator + storefront resolver delegate to. v1 uses small
  // direct SQL lookups instead of forcing new upstream surfaces.
  // Feature 072 (T107) — `megamenu` owns its services and routes now. These
  // two bundles stay here: both are existence checks and URL lookups against
  // OTHER modules' tables, so moving them into the module would give it
  // direct reads of `catalog`, `cms` and `assets_library` storage.
  //
  // Registered after the late pass, where `megamenu` composes and declares
  // its own defaults — contributing earlier would let the module overwrite
  // the root.
  registerValues(container, {
    megamenuValidatorDeps: {
      categoryExists: async (categoryId) => {
        const rows = (await em().getConnection().execute(
          'select 1 from categories where id = ? limit 1',
          [categoryId],
        )) as Array<{ '?column?': number }>;
        return rows.length > 0;
      },
      cmsPageExists: async (pageId) => {
        const rows = (await em().getConnection().execute(
          'select 1 from cms_pages where id = ? limit 1',
          [pageId],
        )) as Array<{ '?column?': number }>;
        return rows.length > 0;
      },
      cmsBlockExists: async (blockId) => {
        const rows = (await em().getConnection().execute(
          'select 1 from cms_blocks where id = ? limit 1',
          [blockId],
        )) as Array<{ '?column?': number }>;
        return rows.length > 0;
      },
      assetIs: async (assetId, expected) => {
        const rows = (await em().getConnection().execute(
          'select 1 from assets where id = ? and kind = ? limit 1',
          [assetId, expected],
        )) as Array<{ '?column?': number }>;
        return rows.length > 0;
      },
    } satisfies TargetValidatorDeps,
    megamenuStorefrontDeps: {
      resolveCategoryUrl: async (categoryId) => {
        const rows = (await em().getConnection().execute(
          'select slug from categories where id = ? limit 1',
          [categoryId],
        )) as Array<{ slug: string }>;
        return rows[0]?.slug ? `/catalog/${rows[0].slug}` : null;
      },
      resolveCmsPageUrl: async (pageId) => {
        const rows = (await em().getConnection().execute(
          'select slug from cms_pages where id = ? limit 1',
          [pageId],
        )) as Array<{ slug: string }>;
        return rows[0]?.slug ? `/${rows[0].slug}` : null;
      },
      resolveAsset: async (assetId) => {
        const rows = (await em().getConnection().execute(
          'select kind, label from assets where id = ? limit 1',
          [assetId],
        )) as Array<{ kind: string; label: string | null }>;
        const row = rows[0];
        if (!row) return null;
        if (row.kind !== 'image' && row.kind !== 'video') return null;
        const resolved = await assetsLibrary.handle.service.resolveUrl(assetId);
        return { url: resolved.url, label: row.label, kind: row.kind };
      },
      resolveCmsBlock: async (blockId, language) => {
        const rows = (await em().getConnection().execute(
          'select id::text, code, content from cms_blocks where id = ? and active = true limit 1',
          [blockId],
        )) as Array<{
          id: string;
          code: string;
          content: { languages?: Record<string, unknown> };
        }>;
        const row = rows[0];
        if (!row) return null;
        const data = row.content.languages?.[language];
        if (data === undefined) return null;
        return {
          id: row.id,
          code: row.code,
          language,
          content: { schemaVersion: 1, data },
        };
      },
    } satisfies StorefrontDeps,
  });
  const megamenuCradle = container.cradle as unknown as MegamenuCradle;
  registerMegamenuCmsReferences(
    cmsCradle.cmsReferenceRegistry,
    megamenuCradle.megamenuReferenceRegistry,
  );
  if (megamenuCradle.megamenuServices.cache) {
    await megamenuCradle.megamenuServices.cache.invalidateAll();
  }

  // Feature 072 — the late pass of the generated module list, at the same point
  // in the boot order `composition.ts` composes it. The host names below are the
  // only thing this root knows about those modules.
  registerValues(container, {
    // `requireAdmin` is NOT here: `auth` provides it as a port (T078).
    // Feature 072 (T078) — the two resolvers the auth plugin reads per request,
    // mirroring `composition.ts`.
    apiKeyResolver: async (token: string) =>
      apiKeysCradle.apiKeyService.authenticate(token),
    // `redis` is registered further up, where the client is created.
    settingsReadPort: settings.handle.settingsService,
    // Feature 072 (T093) — `composition.ts` has registered this since T086;
    // the harness passed the same object to `searchModule` as an option but
    // never registered it, so `cms`' colour-palette writer had nothing to
    // resolve. Mirroring the root is the point of this block.
    settingsAdminService: settings.handle.adminService,
    // Feature 072 (T096) — the harness's own customer guard, which is a
    // different implementation from the root's. Registering it is what makes
    // that divergence visible in one place instead of twenty-seven.
    requireCustomer: requireTestCustomer(),
    // Feature 072 (wave 2) — mirrors `composition.ts`.
    customerContextResolver: customerResolver,
    organizationInheritancePort: organizationInheritanceService,
    catalogAttributeReadPort: catalogAttributeReadService,
    // Feature 072 (wave 2) — mirrors `composition.ts`, reading this harness's
    // own actor property. The ad modules resolve one name instead of each
    // taking its own identically-shaped `resolveAuditContext` option.
    adminAuditActorResolver: (request: FastifyRequest) => ({
      actorAdminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : null,
    }),
    // Feature 072 (wave 2) — **undefined on purpose.** A BullMQ queue built per
    // `setupBackendServer()` is never closed and this harness is constructed
    // once per test file inside a single fork, so the ad modules must get no
    // queue here. `/collect` therefore degrades to 503 and is contract-tested
    // against its own bare instance instead. `redis` is registered above; this
    // is the name that says "but not for queues".
    moduleQueueRedis: undefined,
    // Feature 072 (wave 2) — mirrors `composition.ts`.
    salesChannelCodeIdPort: {
      idByCode: async (code: string) =>
        (await salesChannels.handle.resolver.getByCode(code))?.id ?? null,
      codeById: async (id: string) => {
        const { items } = await salesChannels.handle.salesChannelsService.list({});
        return items.find((c) => c.id === id)?.code ?? null;
      },
    },
    settingsChannelResolver: async () =>
      (await salesChannels.handle.resolver.getSystemDefault())?.id ?? 'default',
    blogStorefrontDeps: undefined,
  });
  const lateModules = composeModules(latePassModules(MODULES), {
    container,
    eventBus,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    interceptorRegistry: apiInterceptors,
    ownership: registrationOwnership,
  });
  modules.push(...lateModules.sink.plugins);

  // Registered **after** the late pass on purpose: `audit_logs` registers its
  // own empty default there, so a value written before composition would be
  // overwritten by it (the same trap `prompt_actions` hit).
  registerValues(container, {
    // Feature 072 (T117) — composition-specific sitemap tuning: regeneration is
    // deterministic with no staleness window, and a fixed base URL gives the
    // assertions something stable. Production contributes nothing and takes the
    // module's own `{}`.
    //
    // Registered **after** the late pass on purpose. `seo` composes there and
    // registers its own `{}` default, so contributing earlier would have the
    // module overwrite the root — which is exactly what happened, and the
    // sitemap silently fell through to `http://localhost:3000`.
    sitemapOptions: { staleAfterMs: 0, baseUrl: 'http://test.local' },
    // Feature 072 (T084) — `audit_logs` owns its routes now and no longer
    // reaches into `admin_users` for identities. Turning an actor id into a
    // name is a **contribution**, so it is gated here rather than declared as
    // a dependency: the audit log must stay readable when `admin_users` is
    // off, and it degrades to raw ids instead of refusing. Deciding what
    // "`admin_users` is present" means is a root's job, not the reading
    // module's; this entry disappears when `admin_users` converts and
    // publishes the resolver itself.
    // Feature 072 (T089) — mirrors `composition.ts`: `_i18n` reads it for the
    // per-admin language preference, and it is `admin_users`' own instance.
    // The harness used to build a third one for that module alone.
    adminUserService: admin.handle.adminUserService,
    // Feature 072 (T089) — the harness composes no `_lifecycle`, so there is no
    // manifest registry to walk and `_i18n`'s reconcile is a no-op here. That
    // was already true before the conversion (the old call site passed no
    // `registry` option at all); making the absence an explicit registration is
    // what lets the module resolve one name in both compositions.
    lifecycleManifestRegistry: () => undefined,
    auditActorResolver: async (ids: string[]) => {
      if (!effectiveState.isPresent('admin_users')) throw new ModuleDisabledError('admin_users');
      const users = await admin.handle.adminUserService.listByIds(ids);
      return users.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
      }));
    },
  });
  await lateModules.runBootHooks();

  // Feature 043 / 072 — the assistant's contribution points, mirroring
  // `composition.ts`. They are registered **after** the late pass because the
  // module registers its own empty defaults there; a value written before
  // composition would be overwritten by them.
  const catalogToolDeps = {
    emFactory: em,
    events: eventBus,
    auditLogService,
    salesChannelMembership: salesChannels.handle.membershipService,
    redis,
  };
  registerValues(container, {
    promptActionsBulkProgressResolver: catalogBulkProgressResolver(catalogToolDeps),
    ...(options.promptActionsLlmFetch === undefined
      ? {}
      : { promptActionsLlmFetch: options.promptActionsLlmFetch }),
    ...(options.promptActionsNow === undefined
      ? {}
      : { promptActionsNow: options.promptActionsNow }),
    ...(options.promptActionsTtlMinutes === undefined
      ? {}
      : { promptActionsTtlMinutes: options.promptActionsTtlMinutes }),
  });
  const promptActionsCradle = container.cradle as unknown as PromptActionsCradle;
  for (const tool of [
    ...catalogPromptResolverTools(catalogToolDeps),
    ...catalogPromptMutationTools(catalogToolDeps),
    ...inventoryPromptTools({ emFactory: em, eventBus, auditLogService }),
  ]) {
    promptActionsCradle.promptActionToolRegistry.register(tool);
  }

  const blogCradle = container.cradle as unknown as BlogCradle;
  if (blogCradle.blogCacheService) await blogCradle.blogCacheService.invalidateAll();

  const dictionariesCradle = container.cradle as unknown as DictionariesCradle;
  if (dictionariesCradle.dictionaryCache) await dictionariesCradle.dictionaryCache.invalidateAll();

  // Feature 006 — Search module. Owns the Meilisearch indexer + event
  // subscriber lifecycle. Wires the same settings-aware path the
  // production composition uses so contract tests can exercise the
  // LLM-toggle wrapper end-to-end. Foundation tests don't need
  // Meilisearch up; the subscriber's handlers swallow Meilisearch
  // errors so a missing backend doesn't break catalog writes.
  const search = searchModule({
    emFactory: em,
    eventBus,
    catalogAttributeRead: catalogAttributeReadService,
    settingsService: settings.handle.settingsService,
    settingsAdminService: settings.handle.adminService,
    credentials: credentialsService,
    requireAdmin: requireTestAdmin(permissionService),
    enrichSuggestionPricing: createSuggestionPricingEnricher({
      emFactory: em,
      pricingService: priceLists.handle.pricingService,
    }),
    resolveAdminAuditContext: (request) => ({
      actorAdminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
  });
  modules.push(search.plugin);

  // Feature 007 — Comparisons module. Customer-facing CRUD endpoints
  // exercised by US1 contract + integration tests; share/PDF/admin land
  // in subsequent stories.
  // Feature 072 (T111) — `comparisons` owns its services and routes now.
  const comparisonsCradle = container.cradle as unknown as ComparisonsCradle;
  // Late-bind the comparisons adoption hook used by the login flow above.
  comparisonAdoption = comparisonsCradle.comparisonService.adoptAnonymousComparison.bind(
    comparisonsCradle.comparisonService,
  );

  // Feature 008 — Quote Requests workflow.
  const quoteRequests = quoteRequestsModule({
    emFactory: em,
    eventBus,
    requireCustomer: requireTestCustomer(),
    requireAdmin: requireTestAdmin(permissionService),
    customFieldValues: customFieldValueService,
    resolveCustomerContext: async (request) => {
      const ctx = customerResolver(request);
      const account = await em().findOne(CustomerAccount, { id: ctx.customerAccountId });
      return {
        customerAccountId: ctx.customerAccountId,
        organizationId: ctx.organizationId,
        isOrgAdmin: account?.role === 'organization_admin',
      };
    },
    resolveAdminContext: async (request) => {
      const adminUserId = request.testActor?.kind === 'admin'
        ? request.testActor.adminUserId
        : TEST_ADMIN_ID;
      const adminUser = await em().findOne(AdminUser, { id: adminUserId });
      const role = adminUser?.adminRoleId
        ? await em().findOne(AdminRole, { id: adminUser.adminRoleId })
        : null;
      return {
        adminUserId,
        isPlatformAdmin: role?.code === 'platform_admin' || true,
        roleLabel: role?.code === 'platform_admin' ? 'Platform administrator' : 'Sales representative',
      };
    },
    resolveExpiryDays: async () => 0,
    resolveBoolSetting: async () => true,
    resolveTaxRate: async (organizationId: string) => {
      try {
        const org = await em().findOne(Organization, { id: organizationId });
        const vatStatus = org?.vatStatus ?? 'vat_payer';
        if (vatStatus !== 'vat_payer') return 0;
        const country = org?.registeredAddress?.country ?? 'PL';
        const resolved = await taxesCradle.taxService.taxRateFor({
          country,
          productType: 'simple',
          vatStatus,
        });
        return resolved.rate;
      } catch {
        return 0;
      }
    },
    auditLog: auditLogService,
  });
  modules.push(quoteRequests.register);

  // Feature 040 — Customers module (mirrors composition.ts wiring).
  const customers = customersModule({
      customerAuthService: customerAccountsCradle.customerAuthService,
      passwordResetService: customerAccountsCradle.passwordResetService,
    emFactory: em,
    sessionService,
    requireCustomer: requireTestCustomer(),
    commandBus,
    customFieldValues: customFieldValueService,
    resolveCustomerActor: (request) => {
      if (request.testActor?.kind !== 'customer') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
      }
      return {
        customerAccountId: request.testActor.customerAccountId,
        organizationId: request.testActor.organizationId ?? null,
      };
    },
    resolveAllowRegistrationWithoutOrganization: async () => {
      try {
        const { z } = await import('zod');
        const channel = await salesChannels.handle.resolver.getSystemDefault();
        if (!channel) return false;
        return await settings.handle.settingsService.get(
          'customers.allow_registration_without_organization',
          channel.id,
          z.boolean(),
        );
      } catch {
        return false;
      }
    },
    getOrderListService: () => {
      if (!orderListServiceForCustomers) {
        throw new Error('OrderListService not yet bound');
      }
      return orderListServiceForCustomers;
    },
    rfqService: quoteRequests.handle().rfqService,
    auditLogService,
    organizationRestrictionService: sharedRestrictionService,
    requireAdmin: requireTestAdmin(permissionService),
    mailer: emailMailer,
    storefrontBaseUrl: 'http://localhost:3000',
    resolveDeletionRetentionDays: async () => 365,
    resolvePresenceFreshnessMinutes: async () => 10,
    // Feature 072 (T071) — the same fake the organizations wiring gets, rather
    // than a second one that answered differently for the same tax id.
    vatValidator: new FakeVatValidator('vies'),
    resolveModerationActor: async (request) => {
      const adminUserId =
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID;
      const adminUser = await em().findOne(AdminUser, { id: adminUserId });
      const role = adminUser?.adminRoleId
        ? await em().findOne(AdminRole, { id: adminUser.adminRoleId })
        : null;
      const isPlatformAdmin = role?.code !== 'sales_representative';
      const allowedOrganizationIds = isPlatformAdmin
        ? []
        : await sharedSalesRepAssignment.listAssignedOrganizationIds(adminUserId);
      return { adminUserId, isPlatformAdmin, allowedOrganizationIds };
    },
  });
  modules.push(customers.plugin);

  // Feature 046 — Returns & Complaints (Refunds, RMA).
  modules.push(
    returnsModule({
      emFactory: em,
      eventBus,
      settingsService: settings.handle.settingsService,
      requireCustomer: requireTestCustomer(),
      requireAdmin: requireTestAdmin(permissionService),
      resolveCustomerAccountId: (req) =>
        req.testActor?.kind === 'customer' ? req.testActor.customerAccountId : TEST_CUSTOMER_ID,
      resolveAdminUserId: (req) =>
        req.testActor?.kind === 'admin' ? req.testActor.adminUserId : TEST_ADMIN_ID,
      orderContext: new OrderReturnContextProvider(em),
      paymentRefund: new PaymentRefundProvider(em),
      correctiveInvoice: new CorrectiveInvoiceProvider(
        em,
        new InvoiceNumberGenerator(createSettingsPatternResolver(settings.handle.settingsService)),
        auditLogService,
        eventBus,
      ),
      creditTopup: new CreditTopupProvider(creditLimitsCradle.creditLimitService),
      auditLog: auditLogService,
      notifier: new ReturnEmailNotifier(
        injectedMailer,
        async (cid) => (await em().findOne(CustomerAccount, { id: cid }))?.email ?? null,
        {
          getTransactionalEmailSender: () => transactionalEmailSender,
          resolveLanguage: async (salesChannelId) =>
            (await em().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage ?? 'en-US',
        },
      ),
    }),
  );

  // Feature 047 — Invoices.
  const invoices = invoicesModule({
      emFactory: em,
      eventBus,
      requireAdmin: requireTestAdmin(permissionService),
      requireCustomer: requireTestCustomer(),
      settingsService: settings.handle.settingsService,
      audit: auditLogService,
      auditLog: auditLogService,
      resolveAdminUserId: (req) =>
        req.testActor?.kind === 'admin' ? req.testActor.adminUserId : TEST_ADMIN_ID,
      resolveCustomerContext: (req) => ({
        customerAccountId:
          req.testActor?.kind === 'customer' ? req.testActor.customerAccountId : TEST_CUSTOMER_ID,
        organizationId:
          req.testActor?.kind === 'customer'
            ? req.testActor.organizationId ?? TEST_ORGANIZATION_ID
            : TEST_ORGANIZATION_ID,
      }),
      getTransactionalEmailSender: () => transactionalEmailSender,
      resolveRecipientEmail: async (order) =>
        (await em().findOne(CustomerAccount, { id: order.placedByCustomerAccountId }))?.email ?? null,
      resolveLanguage: async (salesChannelId) =>
        (salesChannelId
          ? (await em().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage
          : null) ?? 'en-US',
  });
  modules.push(invoices.plugin);

  // Feature 059 — KSeF. No redis queue in tests (submissions are processed by
  // driving `submissions.process(...)` directly); the sweep interval is off.
  const ksef = ksefModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    settingsService: settings.handle.settingsService,
    commandBus,
    eventBus,
    invoices: {
      buildDetail: (invoiceId) => invoices.handle.invoiceService.buildDetail(invoiceId),
      recordKsefAssignment: (invoiceId, assignment) =>
        invoices.handle.invoiceService.recordKsefAssignment(invoiceId, assignment),
    },
    auditLogService,
    ...(process.env['SETTINGS_SECRET_ENCRYPTION_KEY']
      ? { secretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] }
      : {}),
    resolveSellerNip: async () => {
      try {
        const { z: zod } = await import('zod');
        const raw = await settings.handle.settingsService.get('invoices.seller.tax_id', '00000000-0000-0000-0000-000000000000', zod.string());
        const nip = raw.replace(/^PL/i, '').replace(/[\s-]/g, '');
        return nip.length > 0 ? nip : null;
      } catch {
        return null;
      }
    },
    ...(options.ksefClientFactory ? { clientFactory: options.ksefClientFactory } : {}),
    sweepIntervalMs: 0,
    pollAttempts: 3,
    pollIntervalMs: 5,
  });
  modules.push(ksef.plugin);
  invoices.handle.pdfRenderer.setKsefVerificationResolver(ksef.handle.buildVerification);

  // Feature 067 — Product Feed. Deliberately NO `redis` and NO `runWorkers`:
  // `setupBackendServer()` runs once per test file in a single fork, and adding
  // BullMQ connections here has previously taken ~225 files down with "too many
  // clients" (research §R18). Tests drive `productFeeds.generation.generateNow`
  // directly, exactly as the KSeF tests drive `submissions.process`.
  const productFeeds = productFeedsModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    commandBus,
    eventBus,
    storageAdapters: {
      getActive: () => assetsLibrary.handle.adapters.getActive(),
      getForBackend: async (backend) => {
        const adapter = await assetsLibrary.handle.adapters.getForBackend(backend);
        if (!('open' in adapter) || typeof adapter.open !== 'function') {
          throw new Error(
            `product_feeds: storage backend "${backend}" cannot stream artefact bytes.`,
          );
        }
        return adapter;
      },
    },
    salesChannelMembership: salesChannels.handle.membershipService,
    pricingService: priceLists.handle.pricingService,
    taxService: taxesCradle.taxService,
    resolveAvailability: async (productIds, salesChannelId) => {
      const warehouseIds =
        await new WarehouseChannelService(em).resolveCandidateWarehouseIds(salesChannelId);
      return new StockLevelService(em).resolveAvailabilityBands(
        productIds,
        warehouseIds.length > 0 ? warehouseIds : undefined,
      );
    },
    // FR-025 — category criteria include descendants, read through the
    // documented catalog port rather than a `product_categories` query here.
    expandCategoryProductIds: (categoryIds) =>
      new CatalogQueryService(em).expandCategoryProductIds(categoryIds),
    resolvePublicImageUrls: async (assetIds) => {
      const out = new Map<string, string>();
      if (assetIds.length === 0) return out;
      const assets = await em().find(Asset, {
        id: { $in: assetIds },
        visibility: 'public',
        deletedAt: null,
      });
      for (const asset of assets) {
        try {
          const resolved = await assetsLibrary.handle.service.resolveUrl(asset.id);
          // Signed ⇒ not stable ⇒ not publishable (FR-043).
          if (resolved.expiresAt === null && /^https?:\/\//i.test(resolved.url)) {
            out.set(asset.id, resolved.url);
          }
        } catch {
          // Unresolvable ⇒ simply not an image for this feed.
        }
      }
      return out;
    },
    customFieldDefinitions: customFieldDefinitionService,
    languageService: languagesCradle.languageService,
    // FR-056 — a failed run has to be able to raise the operator notification
    // the integration tests assert on. The module instance lives inside the
    // feature-026 wiring block above, which exposes it on this handle.
    adminNotificationService: handleFeature026.adminNotificationService,
    settings: settings.handle.settingsService,
    publicBaseUrl: 'http://feeds.test.local',
    // Tests deliberately do not load `backend/.env`, so a deterministic key is
    // supplied here rather than read from the environment: several suites set
    // and `delete` `SETTINGS_SECRET_ENCRYPTION_KEY` around themselves, and
    // files share a fork, so depending on it would make this module's
    // behaviour depend on test ordering. A literal keeps the feed's
    // re-readable link exercising the real cipher in every run.
    tokenEncryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    // Deliberately a path that does not exist: no test may read the shipped
    // ~1.5 MB taxonomy files. The taxonomy tests construct their own
    // reconciler pointed at a small fixture instead.
    taxonomyDataRoot: '/nonexistent/product-feeds-taxonomies',
    // FR-087 / research §R23 — the egress seam. The default below cannot make a
    // request: it returns a transport failure and records the attempt, so a
    // code path that starts fetching without a test opting in shows up as a
    // failed check rather than as a real download.
    taxonomySourceFetcher: options.taxonomySourceFetcher ?? refusingTaxonomyFetcher(),
    // Feature 070 — every delivery secret lives in the credentials module
    // (FR-107), so delivery exists only where that module is wired.
    credentials: credentialsService,
    deliveryAdapters: options.feedDeliveryAdapters ?? refusingDeliveryAdapters(),
  });
  modules.push(productFeeds.plugin);
  await productFeeds.handle.reconcileTemplates();

  // Feature 068 — Ergonode PIM. Deliberately NO `redis` and NO `runWorkers`,
  // for the same reason product_feeds above has neither: one fork per test file
  // cannot afford a BullMQ connection per module. Integration tests drive the
  // import pipeline directly rather than through a job.
  //
  // The catalogue write surface is constructed here exactly as production
  // composition builds it, so what a test exercises is the path a real import
  // takes — Command Bus, channel binding and all.
  const pimErgonode = pimErgonodeModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    commandBus,
    eventBus,
    credentials: credentialsService,
    catalogAdmin: new CatalogAdminService(
      em,
      eventBus as unknown as CatalogEventBus,
      auditLogService,
      salesChannels.handle.membershipService,
      commandBus,
      catalogAttributeReadService,
      customFieldDefinitionService,
    ),
    categoryAdmin: new CategoryAdminService(
      em,
      salesChannels.handle.membershipService,
      commandBus,
      customFieldValueService,
    ),
    attributeSets: new AttributeSetService(em, commandBus, catalogAttributeReadService),
    gallery: new GalleryService(em, commandBus),
    attachments: new AttachmentService(em, commandBus),
    productLinks: new ProductLinkService(em, commandBus),
    grouped: new GroupedService(em, commandBus),
    assets: assetsLibrary.handle.service,
    priceLists: priceLists.handle.priceListService,
    currencies: currencyService,
    languageService: languagesCradle.languageService,
    adminNotificationService: handleFeature026.adminNotificationService,
    settings: settings.handle.settingsService,
    // The egress seam. The default REFUSES every stream read rather than
    // answering empty: an empty source is a plausible fixture, so a silent
    // default would let a test that forgot to script the source pass while
    // importing nothing.
    ergonodeClient: options.ergonodeClient ?? refusingErgonodeClient(),
    // The byte egress. The real fetcher opens sockets; an empty scripted one
    // answers `not_found` for everything, which is a failure a test can see
    // rather than an outbound connection it cannot.
    mediaFetcher: options.ergonodeMediaFetcher ?? new ScriptedErgonodeMediaFetcher(),
  });
  modules.push(pimErgonode.plugin);

  // Feature 047 — Transactional Emails.
  emailDefaultsRegistry.register('order_confirmation', {
    defaultSubject: ORDER_CONFIRMATION_DEFAULT.defaultSubject,
    defaultContent: ORDER_CONFIRMATION_DEFAULT.defaultContent,
  });
  emailDefaultsRegistry.register('order_comment', {
    defaultSubject: ORDER_COMMENT_DEFAULT.defaultSubject,
    defaultContent: ORDER_COMMENT_DEFAULT.defaultContent,
  });
  emailDefaultsRegistry.register('reorder_created', {
    defaultSubject: REORDER_CREATED_DEFAULT.defaultSubject,
    defaultContent: REORDER_CREATED_DEFAULT.defaultContent,
  });
  emailDefaultsRegistry.register('admin_created_order', {
    defaultSubject: ADMIN_CREATED_ORDER_DEFAULT.defaultSubject,
    defaultContent: ADMIN_CREATED_ORDER_DEFAULT.defaultContent,
  });
  emailDefaultsRegistry.register('return_authorized', {
    defaultSubject: RETURN_AUTHORIZED_DEFAULT.defaultSubject,
    defaultContent: RETURN_AUTHORIZED_DEFAULT.defaultContent,
  });
  emailDefaultsRegistry.register('return_rejected', {
    defaultSubject: RETURN_REJECTED_DEFAULT.defaultSubject,
    defaultContent: RETURN_REJECTED_DEFAULT.defaultContent,
  });
  emailDefaultsRegistry.register('email_verification', {
    defaultSubject: EMAIL_VERIFICATION_DEFAULT.defaultSubject,
    defaultContent: EMAIL_VERIFICATION_DEFAULT.defaultContent,
  });
  emailDefaultsRegistry.register('organization_invitation', {
    defaultSubject: ORGANIZATION_INVITATION_DEFAULT.defaultSubject,
    defaultContent: ORGANIZATION_INVITATION_DEFAULT.defaultContent,
  });
  emailDefaultsRegistry.register('new_org_registration', {
    defaultSubject: NEW_ORG_REGISTRATION_DEFAULT.defaultSubject,
    defaultContent: NEW_ORG_REGISTRATION_DEFAULT.defaultContent,
  });
  emailDefaultsRegistry.register('low_stock_alert', {
    defaultSubject: LOW_STOCK_ALERT_DEFAULT.defaultSubject,
    defaultContent: LOW_STOCK_ALERT_DEFAULT.defaultContent,
  });
  emailDefaultsRegistry.register('availability_back_in_stock', {
    defaultSubject: AVAILABILITY_BACK_IN_STOCK_DEFAULT.defaultSubject,
    defaultContent: AVAILABILITY_BACK_IN_STOCK_DEFAULT.defaultContent,
  });
  emailDefaultsRegistry.register('payment_status_changed', {
    defaultSubject: PAYMENT_STATUS_CHANGED_DEFAULT.defaultSubject,
    defaultContent: PAYMENT_STATUS_CHANGED_DEFAULT.defaultContent,
  });
  emailDefaultsRegistry.register('shipment_created', {
    defaultSubject: SHIPMENT_CREATED_DEFAULT.defaultSubject,
    defaultContent: SHIPMENT_CREATED_DEFAULT.defaultContent,
  });
  new PaymentEmailNotifier({
    emFactory: em,
    getTransactionalEmailSender: () => transactionalEmailSender,
  }).attach(eventBus);
  new ShipmentEmailNotifier({
    emFactory: em,
    getTransactionalEmailSender: () => transactionalEmailSender,
  }).attach(eventBus);
  modules.push(
    transactionalEmailsModule({
      emFactory: em,
      settingsService: settings.handle.settingsService,
      requireAdmin: requireTestAdmin(permissionService),
      resolveAdminUserId: (req) =>
        req.testActor?.kind === 'admin' ? req.testActor.adminUserId : TEST_ADMIN_ID,
      manifests: REGISTERED_MANIFESTS.map((e) => e.manifest),
      mailer: injectedMailer,
      auditLog: auditLogService,
      settingsAdmin: settings.handle.adminService,
      exposeSender: (sender) => {
        transactionalEmailSender = sender;
      },
    }),
  );

  modules.push(
    newsletterModule({
      emFactory: em,
      settings: settings.handle.settingsService,
      tokenSecret: 'test-newsletter-secret',
      platformChannelId: (await salesChannels.handle.resolver.getSystemDefault())?.id ?? 'default',
      resolveChannelIdByCode: async (code) =>
        (await salesChannels.handle.resolver.getByCode(code))?.id ?? null,
      publicBaseUrl: 'http://localhost',
      storefrontBaseUrl: 'http://localhost',
      requireAdmin: requireTestAdmin(permissionService),
      settingsWrite: settings.handle.adminService,
      resolveAuditContext: (req) => ({
        actorAdminUserId: req.testActor?.kind === 'admin' ? req.testActor.adminUserId : null,
      }),
      requireCustomer: requireTestCustomer(),
      resolveCustomerAccountId: (req) =>
        req.testActor?.kind === 'customer' ? req.testActor.customerAccountId : '',
      loadCustomerEmail: async (customerAccountId) =>
        (await em().findOne(CustomerAccount, { id: customerAccountId }))?.email ?? null,
      mailer: injectedMailer,
      auditLog: auditLogService,
      emitEvent: (name, payload) =>
        eventBus.emit(name, {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          ...payload,
        }),
      credentials: credentialsService,
    }),
  );

  // Feature 049 — Google Analytics. No redis wired here, so /collect degrades
  // to 503 (queue producer absent); config + admin CRUD are fully exercised.

  // Feature 063 — LinkedIn Ads. Config + mapping CRUD are fully exercised.

  // Feature 064 — Meta Ads. Config + custom-event CRUD are fully exercised.

  // Feature 066 — Google Tag Manager. No redis wired here: a BullMQ queue built
  // per `setupBackendServer()` is never closed, and this harness is constructed
  // once per test file inside a single fork. /collect therefore degrades to 503
  // here (queue producer absent) and is contract-tested against its own bare
  // instance in test/contract/google_tag_manager/collect.test.ts.

  modules.push(
    shoppingListsModule({
      emFactory: em,
      rfqService: quoteRequests.handle().rfqService,
      catalogAttributeRead: catalogAttributeReadService,
      requireCustomer: requireTestCustomer(),
      resolveCustomerContext: customerResolver,
      eventBus,
      exposeShoppingListService: (svc) => {
        shoppingListServiceRef = svc;
      },
      // Feature 039 — register the admin on-behalf quick-order routes and
      // the default-preferences routes.
      requireAdmin: requireTestAdmin(permissionService),
      auditLog: auditLogService,
      organizationRestriction: sharedRestrictionService,
      resolveAdminContext: (request) => ({
        adminUserId:
          request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
      }),
      // Feature 039 — one-click buy wiring.
      getOrderService: () => orderServiceForOneClick,
      resolveOneClickEnabled: async (salesChannelId) => {
        try {
          const { z } = await import('zod');
          return await settings.handle.settingsService.get(
            'quick_order.one_click_buy_enabled',
            salesChannelId,
            z.boolean(),
          );
        } catch {
          return false;
        }
      },
    }),
  );

  if (options.extraModules) modules.push(...options.extraModules);

  modules.push(async (app) => {
    registerApiInterceptorAdminRoutes(app, {
      registry: apiInterceptors,
      requireAdmin: requireTestAdmin(permissionService),
    });
    // Feature 073 — the presence projections and the activation write. The
    // harness does not boot the lifecycle orchestrator (it seeds the registry
    // cache directly below), but every module's off-state test asserts against
    // the admin projection, so these three routes have to exist here.
    //
    // Local refresh is deliberately the *cache seam* rather than a database
    // read: the harness never populates `module_registrations`, so refreshing
    // from the database would blank the seeded enabled-set and take every
    // gated route down mid-run.
    registerModulePresenceRoutes(app, {
      requireAdmin: requireTestAdmin(permissionService),
      activation: {
        commandBus,
        propagation: {
          refreshLocalState: () => registryCache.__refreshActivationForTesting(em),
          publishStateChanged: (payload) => publishStateChanged(redis, payload),
          revalidateStorefront: async () => undefined,
        },
      },
    });
    registerModulePresenceStorefrontRoutes(app);
  });
  options.configureInterceptors?.(apiInterceptors);

  // Feature 004 — boot-time manifest reconciliation. Runs before
  // app.ready() so contract tests start from a consistent settings
  // catalog.
  //   - settingsModuleManifest: built-in `general` group.
  //   - searchManifest:         feature-006 search group + 6 settings.
  // Same derivation the production composition uses, so the harness cannot
  // drift from it — it previously carried its own hand-maintained copy, which
  // is why tests saw KSeF/MFA settings that production never created.
  await new ManifestReconciler(em()).apply(collectRegisteredSettingsManifests());

  const app = await buildServer({
    sessionCookieSecret: 'test-secret-do-not-use-in-production',
    openApi: {
      title: 'B2B Platform API (test)',
      version: 'test',
      serverUrl: 'http://localhost',
    },
    disableRateLimit: true,
    modules,
    apiInterceptors,
    errorEnvelope: {
      resolvePreferredLanguage: async (request) => {
        if (request.testActor?.kind !== 'admin') return null;
        const adminUser = await em().findOne(AdminUser, { id: request.testActor.adminUserId });
        return adminUser?.preferredLanguage === 'pl' ? 'pl' : 'en';
      },
      translateErrorMessage: async ({ moduleId, key, language, originalMessage }) => {
        const translated = await adminI18nCradle.adminI18nService.translate(
          moduleId,
          key,
          language,
        );
        return translated === `${moduleId}.${key}` ? originalMessage : translated;
      },
    },
  });
  // Seed the in-process module registry as "all modules enabled". Production
  // cold-starts this from the `module_registrations` table via
  // `registryCache.start()`, but the test harness never boots the lifecycle
  // orchestrator. Without this, every route wrapped in `defineModuleRoutes`
  // (e.g. the entire `blog` surface) 503s with MODULE_DISABLED, and the
  // permission catalogue would report zero enabled modules. Lifecycle tests
  // that need a specific module disabled override this within their own setup.
  // Feature 073 — install the activation declarations the manifests carry.
  // Production does this inside `registryCache.start()`; without it the
  // operator axis has nothing to resolve, the settings write guards never fire
  // and the activation endpoint reports every module as having no control.
  // Feature 072 (T073) — the other half of the pub/sub path production runs: a
  // module-state change invalidates the permission catalogue.
  //
  // The **subscribe** matters as much as the listener. Without it this handler
  // was dead code: production subscribes through the lifecycle module, which
  // the harness does not boot, so the channel had no subscriber and the
  // listener never fired once.
  if (options.exercisePubSub === true) {
    await redisSubscriber.subscribe(STATE_CHANGED_CHANNEL);
    redisSubscriber.on('message', (channel) => {
      if (channel === STATE_CHANGED_CHANNEL) {
        permissionCatalogueService.invalidate();
      }
    });
  }
  await app.ready();

  return {
    app,
    orm,
    em,
    eventBus,
    apiInterceptors,
    redis,
    redisSubscriber,
    pubSubArmed: options.exercisePubSub === true,
    sessionService,
    auditLogService,
    promptActions: {
      registry: promptActionsCradle.promptActionToolRegistry,
      requestService: promptActionsCradle.promptRequestService,
      providerFactory: promptActionsCradle.llmProviderFactory,
    },
    credentials: { service: credentialsService, configurationTypeRegistry },
    invoices: invoices.handle,
    ksef: ksef.handle,
    productFeeds: productFeeds.handle,
    pimErgonode: pimErgonode.handle,
    pwa: pwa.handle,
    permissionService,
    permissionCatalogueService,
    settings: settings.handle,
    salesChannels: salesChannels.handle,
    integrations: {
      apiKeyService: apiKeysCradle.apiKeyService,
      requireApiKey: apiKeysCradle.requireApiKey,
      requireBoundApiKey: apiKeysCradle.requireBoundApiKey,
    },
    search: search.handle,
    comparisons: { comparisonService: comparisonsCradle.comparisonService },
    assetsLibrary: assetsLibrary.handle,
    cms: cmsCradle.cms.handle,
    megamenu: {
      referenceRegistry: megamenuCradle.megamenuReferenceRegistry,
      cache: megamenuCradle.megamenuServices.cache,
    },
    blog: {
      cache: blogCradle.blogCacheService,
      storefrontResolver: blogCradle.blogStorefrontResolver,
    },
    container,
    dictionaries: {
      validator: dictionariesCradle.dictionaryValidator,
      cache: dictionariesCradle.dictionaryCache,
    },
    adminI18n: { i18nService: adminI18nCradle.adminI18nService },
    promotions: {
      promotionService: promotionsCradle.promotionService,
      couponService: promotionsCradle.promotionCouponService,
      ruleStore: promotionsCradle.promotionRuleStore,
      statsService: promotionsCradle.promotionStatsService,
    },
    customFields: {
      definitionService: customFieldDefinitionService,
      valueService: customFieldValueService,
      cache: customFieldsCradle.customFieldDefinitionsCache,
    },
    // Feature 061 — the composed attribute read model for test fixtures.
    catalogAttributeRead: catalogAttributeReadService,
    organizations: handleFeature026 ?? {
      moderationService: null as unknown as OrganizationModerationService,
      adminNotificationService: null as unknown as AdminNotificationService,
      organizationContextService: null as unknown as OrganizationContextService,
      restrictionService: null as unknown as OrganizationRestrictionService,
    },
    cartService: () => cartService,
  };
}

function customerResolver(request: FastifyRequest): {
  customerAccountId: string;
  organizationId: string;
  impersonatorAdminUserId?: string | null;
} {
  if (request.testActor?.kind !== 'customer') {
    return { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };
  }
  // Feature 026 US2 — testActor.organizationId may be null (no-org Customer).
  // Tests that drive routes requiring an Organization fall back to the
  // shared TEST_ORGANIZATION_ID; tests that genuinely exercise the no-org
  // path use `cartActorResolver` or call services directly.
  return {
    customerAccountId: request.testActor.customerAccountId,
    organizationId: request.testActor.organizationId ?? TEST_ORGANIZATION_ID,
    impersonatorAdminUserId: request.testActor.impersonatorAdminUserId,
  };
}

export async function teardownBackendServer(h: BackendServerHandle): Promise<void> {
  await h.app.close();
  // Feature 072 — runs every registration's disposer and drops the resolution
  // cache, so a file's composed services do not outlive its server.
  await h.container.dispose();
  h.redis.disconnect();
  // Unsubscribe and drop listeners **before** disconnecting. A subscribed
  // client that is merely disconnected keeps its subscription set, and ioredis
  // re-establishes it on any reconnect — which is how one armed subscription
  // per composition became ~1 GB of retention across a run.
  h.redisSubscriber.removeAllListeners('message');
  // Only when something actually subscribed. `unsubscribe()` on a client that
  // never entered subscriber mode rejects asynchronously from ioredis's socket
  // close handler — a rejection no `try` around this call can catch, which
  // surfaced as an unhandled rejection failing otherwise-green runs.
  if (h.pubSubArmed) {
    try {
      await h.redisSubscriber.unsubscribe();
    } catch {
      // Already closed — nothing left to unsubscribe from.
    }
  }
  h.redisSubscriber.disconnect();
  await closeOrm();
}

/**
 * Deterministic VAT validator stub used by the test harness (feature 026 US7).
 *
 *   - taxId ending in `00000` → `validated` with legalName "Test Legal Co"
 *   - taxId ending in `99999` → `deferred` (simulates provider outage)
 *   - everything else → `failed` / `not_found`
 *
 * No real HTTP traffic; lets tests cover all three branches deterministically.
 */
/**
 * The one VAT validator fake (feature 072, T071).
 *
 * There used to be two, and they **disagreed**: this class answered `failed`
 * for `PL0000000099` while an inline object literal in the customers wiring
 * answered `validated` for the same input. Same port, same tax id, two answers
 * — decided by which module happened to be called. That is the failure mode
 * T071 is about: a hand-rolled fake per call site is a second wiring, and two
 * wirings of one port drift the moment either is touched.
 *
 * `PL0000000099` is the seeded organization's tax id and the seed marks that
 * row a VAT payer, so it validates here. A fake that failed it would contradict
 * the fixture it is validating.
 */
class FakeVatValidator implements VatValidator {
  constructor(public readonly provider: 'vies' | 'mf_pl') {}

  async validate(input: { taxId: string }): Promise<VatValidationResult> {
    const cleaned = input.taxId.replace(/[\s-]+/g, '').toUpperCase();
    if (cleaned === TEST_ORGANIZATION_TAX_ID) {
      return {
        outcome: 'validated',
        legalName: 'Test Organization',
        address: null,
        errorKind: null,
      };
    }
    if (cleaned.endsWith('00000')) {
      return {
        outcome: 'validated',
        legalName: 'Test Legal Co',
        address: { line1: 'ul. Testowa 1', city: 'Warszawa', countryCode: 'PL' },
        errorKind: null,
      };
    }
    if (cleaned.endsWith('99999')) {
      return {
        outcome: 'deferred',
        legalName: null,
        address: null,
        errorKind: 'network_timeout',
      };
    }
    return {
      outcome: 'failed',
      legalName: null,
      address: null,
      errorKind: 'not_found',
    };
  }
}
