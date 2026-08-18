import type { AssetsLibraryCradle } from '../../src/modules/assets_library/backend.js';
import type { CartShoppingListBridge, CartsCradle } from '../../src/modules/carts/backend.js';
import type { ConfigurationTypeRegistry } from '../../src/modules/credentials/services/configuration-type-registry.js';
import type { CredentialsService } from '../../src/modules/credentials/services/credentials.service.js';
import type { AdminNotificationService } from '../../src/modules/admin_notifications/services/admin-notification-service.js';
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
  publishStateChanged,
  registryCache,
  STATE_CHANGED_CHANNEL,
} from '../../src/kernel/lifecycle/registry-cache.js';
import { activationDeclarationsFrom } from '../../src/kernel/lifecycle/activation-resolver.js';
import { effectiveState } from '../../src/kernel/lifecycle/effective-state.js';
import { forkScopedEm } from '../../src/tenancy/scoped-em.js';
import { type TenantContext } from '../../src/tenancy/tenant-context.js';
import { registerRequestScopeHook } from '../../src/kernel/request-scope-hook.js';
// Feature 072 — the generated module list, composed in one pass exactly as
// `src/composition.ts` composes it (D-45). Issue #52 — and contributed into
// through the same `composedModules.contribute(…)` window, which is a method
// rather than a convention precisely because this pair kept drifting.
import { MODULES } from '../../src/composition.generated.js';
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
import { buildStaticRegistry } from '../../src/modules/_lifecycle/services/static-registry.js';
import type { LoadedManifestRegistry } from '../../src/modules/_lifecycle/services/manifest-loader.js';
import { ERROR_CODES, type ProductAvailability } from '@b2b/contracts';
import { HttpError } from '../../src/http/error-envelope.js';
import { randomUUID } from 'node:crypto';
import { CustomerAccount } from '../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { AdminUser } from '../../src/modules/admin_users/entities/admin-user.entity.js';
import type { AdminI18nCradle } from '../../src/modules/_i18n/backend.js';
// D-54 — injected into the error envelope, exactly as `composition.ts` does it:
// `src/http` may not name a module (D-52), a composition root may.
import { ERROR_TRANSLATION_KEYS } from '../../src/modules/_i18n/services/error-translation.js';
import { AdminRole } from '../../src/modules/admin_roles/entities/admin-role.entity.js';
import type {
  OrganizationsCradle,
  OrganizationTaxProfilePort,
} from '../../src/modules/organizations/backend.js';
import type { OrganizationModerationService } from '../../src/modules/organizations/services/organization-moderation-service.js';
import type { OrganizationContextService } from '../../src/modules/organizations/services/organization-context-service.js';
import type { OrganizationRestrictionService } from '../../src/modules/organizations/services/organization-restriction-service.js';
import { resolveCustomerRollupSubtreeIds } from '../../src/modules/customer_accounts/services/customer-rollup-scope.js';
import type {
  VatValidator,
  VatValidationResult,
} from '../../src/modules/organizations/services/vat-validator-port.js';
// Feature 072 (T079) — `email` composes through the kernel here too, from the
// generated list. The five hand-rolled `new ConsoleMailer()` fallbacks this
// replaced were the reason a conversion of `composition.ts` alone would have
// proved nothing: every mail-sending suite runs against this root.
import type { EmailCradle } from '../../src/modules/email/backend.js';
import type { AdminUsersCradle } from '../../src/modules/admin_users/backend.js';
import type { ShoppingListService } from '../../src/modules/shopping_lists/services/shopping-list-service.js';
import type { ReturnsBridge } from '../../src/modules/returns/backend.js';
import type { InvoicesBridge, InvoicesCradle } from '../../src/modules/invoices/backend.js';
import type { NewsletterBridge } from '../../src/modules/newsletter/backend.js';
import type { CustomFieldsCradle } from '../../src/modules/custom_fields/backend.js';
import type { CustomFieldDefinitionService } from '../../src/modules/custom_fields/services/custom-field-definition.service.js';
import type { CustomFieldValueService } from '../../src/modules/custom_fields/services/custom-field-value.service.js';
import type { CustomFieldDefinitionsCache } from '../../src/modules/custom_fields/services/custom-field-definitions-cache.js';
import type { ApiKeysCradle } from '../../src/modules/api_keys/backend.js';
import type { CmsCradle } from '../../src/modules/cms/backend.js';
import type { MegamenuCradle } from '../../src/modules/megamenu/backend.js';
import type { TargetValidatorDeps } from '../../src/modules/megamenu/services/target-validator.js';
import type { StorefrontDeps } from '../../src/modules/megamenu/services/storefront-resolver.js';
// Feature 072 — the harness is a second composition root, so a module left
// hand-wired here would keep passing against wiring nobody changed. It composes
// the same generated list production does; only the host values differ.
import type { BlogCradle } from '../../src/modules/blog/backend.js';
import type { DictionariesCradle } from '../../src/modules/dictionaries/backend.js';
import type { CustomerAccountsCradle } from '../../src/modules/customer_accounts/backend.js';
import type { TaxesCradle } from '../../src/modules/taxes/backend.js';
import type { PromotionsCradle } from '../../src/modules/promotions/backend.js';
import { composeSettingsKernel } from '../../src/kernel/settings/compose.js';
import type { SettingsKernel } from '../../src/kernel/settings/compose.js';
import type { SettingsCradle } from '../../src/modules/settings/backend.js';
import type { MfaActorBridge } from '../../src/modules/mfa/backend.js';
import type { OAuthProviderPort } from '../../src/modules/mfa/services/oauth-provider-service.js';
import { composeSalesChannelsKernel } from '../../src/kernel/sales-channels/compose.js';
import type { SalesChannelsKernel } from '../../src/kernel/sales-channels/compose.js';
import type { SalesChannelsCradle } from '../../src/modules/sales_channels/backend.js';
import type { SearchCradle } from '../../src/modules/search/backend.js';
import type { PromptActionsCradle } from '../../src/modules/prompt_actions/backend.js';
import type { PromptActionToolRegistry } from '../../src/modules/prompt_actions/services/tool-registry.js';
import type { PromptRequestService } from '../../src/modules/prompt_actions/services/prompt-request.service.js';
import type { LlmProviderFactory } from '../../src/modules/prompt_actions/services/llm/provider-factory.js';
import type { FetchLike } from '../../src/modules/prompt_actions/services/llm/provider.js';
import type { KsefCradle } from '../../src/modules/ksef/backend.js';
import type {
  ProductFeedsBridge,
  ProductFeedsCradle,
} from '../../src/modules/product_feeds/backend.js';
import type {
  TaxonomyFetchResult,
  TaxonomySourceFetcherPort,
} from '../../src/modules/product_feeds/services/taxonomy-source-fetcher.interface.js';
import {
  FeedDeliveryError,
  type FeedDeliveryAdapter,
} from '../../src/modules/product_feeds/services/delivery/delivery-adapter.interface.js';
import type { FeedDeliveryProtocol } from '@b2b/contracts';
import type { PimErgonodeCradle } from '../../src/modules/pim_ergonode/backend.js';
import type { ErgonodeClientPort } from '../../src/modules/pim_ergonode/services/ergonode-client.port.js';
import type { ErgonodeMediaFetcherPort } from '../../src/modules/pim_ergonode/services/ergonode-media-fetcher.js';
import { refusingErgonodeClient } from './scripted-ergonode-client.js';
import { ScriptedErgonodeMediaFetcher } from './scripted-ergonode-media-fetcher.js';
import { Asset } from '../../src/modules/assets_library/entities/asset.entity.js';
import type { KsefApiClientPort } from '../../src/modules/ksef/integrations/ksef-client.interface.js';
import type { PwaBridge, PwaCradle } from '../../src/modules/pwa/backend.js';
import { SalesChannel } from '../../src/kernel/sales-channels/sales-channel.entity.js';
import { Order } from '../../src/modules/orders/entities/order.entity.js';
import type { ComparisonsCradle } from '../../src/modules/comparisons/backend.js';
import type { CatalogQueryService } from '../../src/modules/catalog/services/catalog-query.service.js';
import { z } from 'zod';
import type { CatalogAttributeReadService } from '../../src/modules/catalog/services/catalog-attribute-read.service.js';
import type { AssetReadPort } from '@b2b/contracts';
import type { PricingServiceContract } from '../../src/modules/price_lists/services/pricing-service.interface.js';
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
  /**
   * Feature 004 — the universal getter and cache invalidator (kernel-composed
   * since T118), plus the module's admin services, resolved from the container.
   */
  settings: SettingsKernel & {
    adminService: SettingsCradle['settingsAdminService'];
    cacheAdminService: SettingsCradle['settingsCacheAdminService'];
  };
  /** Feature 043 — prompt assistant handle (registry + request service). */
  promptActions: {
    registry: PromptActionToolRegistry;
    requestService: PromptRequestService;
    providerFactory: LlmProviderFactory;
  };
  /** Feature 058 — credentials handle (config-type registry + service). */
  credentials: { service: CredentialsService; configurationTypeRegistry: ConfigurationTypeRegistry };
  /** Feature 047 — invoices handle (issuance service, PDF renderer, number generator). */
  invoices: {
    invoiceService: InvoicesCradle['invoiceService'];
    numberGenerator: InvoicesCradle['invoiceNumberGenerator'];
    pdfRenderer: InvoicesCradle['invoicePdfRenderer'];
  };
  /** Feature 059 — KSeF handle (settings, auth, credentials, submissions). */
  ksef: KsefCradle['ksef']['handle'];
  /** Feature 067 — Product Feed handle (feeds, generation, runs, token cache). */
  productFeeds: ProductFeedsCradle['productFeeds']['handle'];
  /** Feature 068 — Ergonode PIM handle (source client seam, queue gate). */
  pimErgonode: PimErgonodeCradle['pimErgonode']['handle'];
  /** Feature 046 — PWA handle (config resolver, push services, delivery queue). */
  pwa: PwaCradle['pwa']['handle'];
  /**
   * Feature 005 — the resolver and membership service (kernel-composed since
   * T110), plus the module's CRUD service, resolved from the container.
   */
  salesChannels: SalesChannelsKernel & {
    salesChannelsService: SalesChannelsCradle['salesChannelsService'];
  };
  /** Feature 062 — api-keys/webhooks handle (api-key gates). */
  integrations: {
    apiKeyService: ApiKeysCradle['apiKeyService'];
    requireApiKey: ApiKeysCradle['requireApiKey'];
    requireBoundApiKey: ApiKeysCradle['requireBoundApiKey'];
  };
  /** Feature 006 — exposes the indexer + suggest service for tests that
   *  want deterministic teardown or to exercise embedder attach/detach. */
  search: SearchCradle['searchHandle'];
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
  /**
   * The `pricingService` port, for fixtures that construct a listing service by
   * hand (issue #132). Read off the container so a fixture prices through the
   * same engine the composed modules do.
   */
  pricingService: PricingServiceContract;
  /**
   * `assets_library`'s read port, for fixtures that construct a catalogue
   * listing or link service by hand (feature 075). Read off the container for
   * the same reason `pricingService` is: a fixture resolves the instance the
   * composed module resolves, not a second one built beside it.
   */
  assetRead: AssetReadPort;
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

/**
 * The manifest registry `_i18n` walks to reconcile every module's
 * `translation_bundles` rows (issue #158).
 *
 * The harness used to contribute `() => undefined` here, on the grounds that it
 * composes no `_lifecycle` and therefore has no registry to hand over. The
 * registry is not `_lifecycle`'s to begin with: it is the manifest set the
 * deployment resolved, which this root already registers as
 * `resolvedModuleRegistry`. Handing `_i18n` the same list is what production
 * does, one object later.
 *
 * The consequence of the absence was not that bundles were stale — it was that
 * `translation_bundles` was **empty** in every test, so the error envelope's
 * whole translation path (`preSerialization` → `translate` → the module's
 * bundle) ran in a composition where every lookup missed and fell back to the
 * original message. Issue #65 shipped through that gap: an envelope replacing a
 * written refusal with the generic family sentence on four transacting
 * surfaces, with a green suite.
 *
 * Built once per process, not once per composition. `translation_bundles` is
 * configuration rather than transactional state — it is not in `SEEDED_TABLES`
 * — and the registry is a pure function of the committed manifest index, so a
 * second build would produce an identical object. The *reconcile* still runs
 * per composition (`_i18n` runs it at plugin attach), which is what keeps a
 * file that edits a bundle from leaking into the next one.
 */
let cachedManifestRegistry: LoadedManifestRegistry | undefined;
function harnessManifestRegistry(): LoadedManifestRegistry {
  cachedManifestRegistry ??= buildStaticRegistry(
    REGISTERED_MANIFESTS.map((entry) => ({
      manifest: entry.manifest,
      filePath: entry.filePath,
    })),
  );
  return cachedManifestRegistry;
}

/**
 * The error code this harness proves the translation path with, and why it is a
 * constant rather than "any key that happens to be there".
 *
 * `CART_EMPTY` routes to `core` in `ERROR_TRANSLATION_KEYS` and `_i18n` ships a
 * sentence for it in both languages, so resolving it walks the whole path the
 * envelope walks on a real refusal: the merged bundle for the language, the
 * `_i18n` → `core` namespace rename, and the `errors.<CODE>` key inside it.
 */
const TRANSLATION_PROOF = { moduleId: 'core', key: 'errors.CART_EMPTY' } as const;

/**
 * Refuse to hand back a server whose error messages cannot be translated
 * (issue #158).
 *
 * This is the `withModuleOff` move, applied to a different substitution. That
 * helper asserts the flip actually took before the test body observes anything,
 * because a test that silently observed an un-flipped module would assert
 * nothing. The same hazard lived here in a quieter form: with
 * `translation_bundles` empty, `translateErrorMessage` missed on every key and
 * the composition root's translator answered with the **original message** — so
 * every error assertion in the suite passed while the translation path had never
 * run. Issue #65 shipped through that gap: an envelope replacing four transact
 * gates' written refusal with the generic `FORBIDDEN` sentence, green suite.
 *
 * A failure here is not a flaky test, it is the harness reporting that it stopped
 * being a platform. So it throws with the cause named rather than warning.
 */
async function assertErrorTranslationsInstalled(i18n: {
  translate(moduleId: string, key: string, language: 'en'): Promise<string>;
}): Promise<void> {
  const { moduleId, key } = TRANSLATION_PROOF;
  const resolved = await i18n.translate(moduleId, key, 'en');
  // `translate` answers a miss with `<moduleId>.<key>` — the placeholder that
  // makes the envelope keep the original message.
  if (resolved === `${moduleId}.${key}`) {
    throw new Error(
      `[test-server] "${moduleId}.${key}" did not resolve, so translation_bundles is ` +
        `empty or stale and no error message in this composition is translated. ` +
        `The harness contributes the manifest registry to \`lifecycleManifestRegistry\` ` +
        `precisely so \`_i18n\` reconciles the bundles from disk at plugin attach; ` +
        `check that contribution before treating this as a data problem.`,
    );
  }
}

/**
 * The Redis namespaces that key by a **stable business key** (a channel code, a
 * setting code) while storing the row's id.
 *
 * Every `setupBackendServer` truncates and reseeds with fresh random ids, so an
 * entry surviving that swap points at a row that no longer exists. CI gets an
 * ephemeral Redis per run; a developer's local Redis persists across runs, which
 * is why this is not merely a within-run concern.
 *
 * (`cms` / `megamenu` / `blog` / `dictionaries` clear their own caches further
 * down through their module handle's `invalidateAll()`, which also drops the
 * per-process LRU the composition holds.)
 */
async function dropStaleCaches(redis: Redis): Promise<void> {
  // `sales-channels:*` covers every cache version (feature 053 bumped it to v2).
  for (const pattern of ['session:*', 'sales-channels:*', 'settings:v1:*']) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(keys);
  }
}

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
  //
  // Done **twice**, here and again after the reseed (`dropStaleCaches` below).
  // This call is the one the seeding needs: it stops a seed insert from reading
  // a dead id through the cache and failing on the foreign key. But a drop that
  // happens *before* the rows it protects against are deleted leaves a window —
  // every statement from the `truncate` to the last seed — in which a read
  // re-pins a pre-truncate id under a code that survives the reseed. You drop a
  // cache after invalidating its source, not before, and the second call is that
  // drop.
  await dropStaleCaches(redis);

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

  // The second drop — the one the composition below needs. Every row the caches
  // key by now exists with the id it will have for the rest of this file, so
  // nothing read from here on can be a pre-truncate id wearing a code that
  // survived the reseed.
  //
  // That is the shape issue #154 reported: `public-ignores-bearer.test.ts`
  // failed once in a 67-file run with the anonymous body `data: []` and the
  // bearer body carrying three products. The two requests resolve their channel
  // differently — anonymous by **code** through this cache, a bound api key by
  // **id** from its binding — so a cached `pl_retail` pointing at a dead id
  // produces exactly that asymmetry, 200 and all. It has not been reproduced,
  // so this is not filed as the fix; the drop order was wrong on its own terms
  // and is worth correcting whether or not it was the cause.
  await dropStaleCaches(redis);

  const eventBus = new EventBus();

  // Feature 054 — mirror production: the Command Bus is the audited write path.
  const commandBus = new CommandBus(orm, auditLogService, eventBus);

  // Feature 072 (T078) — the enabled set is seeded **before** the modules
  // compose, not at the end of this function where it used to sit.
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

  // Mirrors `composition.ts`: the **host values** this root owns outright. No
  // module registers a default for any of them, so they have no contribution
  // window and are registered where the value comes into existence.
  registerValues(container, {
    redis,
    // Feature 072 (T125) — the interceptor registry, so `_lifecycle` can serve
    // the read-only diagnostics screen over it. It was already declared
    // platform-owned; until this conversion nothing resolved it by name, so
    // nothing noticed that no root registered it.
    apiInterceptors,
    // The module's `ctx.onBoot` schedule reconcile resolves this (T131).
    pimErgonodeRunWorkers: false,
    productFeedsRunWorkers: false,
    productFeedsPublicBaseUrl: 'http://feeds.test.local',
    productFeedsTokenEncryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
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
    // Feature 072 (T138) — mirrors `composition.ts`, reading this harness's own
    // actor property. Soft by contract: `null` for anonymous traffic and for a
    // Customer with no Organization.
    customerOrganizationIdResolver: (request: FastifyRequest): string | null =>
      request.testActor?.kind === 'customer' ? request.testActor.organizationId ?? null : null,
    storefrontBaseUrl: 'http://localhost:3000',
    // The one composition allowed to serve `/api/v1/_test/latest-verification-token`.
    organizationsExposeTestProbe: true,
  });
  // T143a — `inventory`'s availability port, mirroring `composition.ts`.
  const inventoryCradle = (): {
    inventoryAvailabilityPort: {
      resolveAvailabilityBands(
        productIds: string[],
        salesChannelId: string,
      ): Promise<Map<string, { band: string; inStock: boolean }>>;
    };
  } => container.cradle as never;

  // Mirrors `composition.ts`. Neither cache depends on where this call sits any
  // more: the settings drop stopped being a subscription under issue #45 and
  // the sales-channel drop under D-93, so both are part of the write and no
  // `ctx.subscribe` handler can be ahead of either.
  const salesChannels = composeSalesChannelsKernel({
    emFactory: em,
    eventBus,
    redis,
    auditLogService,
  });
  // Feature 072 (T118) — the kernel composes the settings reader; the module
  // owns the admin surface and composes itself.
  const settings = composeSettingsKernel({
    emFactory: em,
    redis,
    ...(process.env['SETTINGS_SECRET_ENCRYPTION_KEY']
      ? { secretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] }
      : {}),
  });

  // Feature 072 — the generated module list, composed in one pass at the same
  // point in the boot order `composition.ts` composes it. Its boot hooks run
  // once, at the bottom of this function, after every contribution below.
  const composedModules = composeModules(MODULES, {
    container,
    eventBus,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    interceptorRegistry: apiInterceptors,
    ownership: registrationOwnership,
  });

  // Feature 072 (T094) — one `CustomerAuthService` for the composition.
  // `customers` and `organizations` each built their own and the MFA argument
  // differed between them; there is one now, and it can always reach the port.

  // Feature 072 (T095/T097) — `payment_methods` and `delivery_methods` own
  // their registries, eligibility services and routes now. `orders` resolves
  // them itself, so nothing is read here.
  //
  // T143a — the built-in payment adapters are seeded by `payments`, from its
  // own boot hook. Both roots ran the loop, and this copy carried the same
  // `isRegistered` guard for a reason neither stated: the registry is a
  // process-wide singleton, so several hundred compositions in one suite were
  // all writing the same instance.

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

  // `currencyService` is resolved from the container where it is needed —
  // `pim_ergonode` reads it as a port since T131, and nothing else here did.

  // Feature 072 (wave 1) — `admin_notifications` provides this as a port, so a
  // cross-module write answers on its effective state rather than succeeding
  // into a module the operator switched off.
  const adminNotificationService = (
    container.cradle as unknown as { adminNotificationService: AdminNotificationService }
  ).adminNotificationService;
  // The enabled-set accessor is wired here rather than with the seeding above,
  // because the catalogue it wires is `admin_roles`' registration and does not
  // exist until `composeModules` has run.
  permissionCatalogueService.setEnabledModuleIdsAccessor(() => registryCache.enabledIds());

  // The mailer this composition sends through. A test that asserts on sent mail
  // supplies its own; otherwise it is the one the `email` module registered.
  //
  // Feature 072 (T120) — **registered back into the container**, not just held
  // as a local. The comment here used to say this was "the one seam that stays,
  // because the modules that take it are not converted yet"; every module is
  // converted now, and each resolves `emailMailer` as a port. Holding the spy
  // in a variable and passing it to two module factories was what kept it
  // reachable, and as those factories disappeared the spy went blind one path
  // at a time — silently, because the mail was still being sent, just to the
  // container's `ConsoleMailer`.
  //
  // `emailMailer` is a `ctx.di.register` contribution point rather than a
  // `providePort`, so overwriting it is the sanctioned move rather than a root
  // shadowing a module's port. It is registered after `composeModules`, in the
  // one contribution slot, so this overrides `email`'s default rather than being
  // overwritten by it.
  //
  // D-59 — `emailMailer` is now the *recording* mailer: the driver plus the
  // delivery record. A spy supplied here replaces both, so a test that injects
  // one asserts on messages and writes no `email_deliveries` row. That is
  // deliberate — the alternative is every mail-sending suite in the tree
  // acquiring a database write it never asked for — and the composed path is
  // covered directly by `test/integration/email/delivery-record.test.ts`, which
  // sends through the container's own mailer.
  const emailMailer = (container.cradle as unknown as EmailCradle).emailMailer;
  const injectedMailer = options.organizationsMailer ?? emailMailer;
  if (options.organizationsMailer) {
    composedModules.contribute({ emailMailer: injectedMailer });
  }

  // CartService is exposed by the commerce module so the login handler in
  // organizations can merge anonymous baskets after sign-in.
  let shoppingListServiceRef: import('../../src/modules/shopping_lists/services/shopping-list-service.js').ShoppingListService | null = null;
  // Feature 039 — late-bound OrderService for the quick_order one-click flow.
  let orderServiceForOneClick: import('../../src/modules/orders/services/order-service.js').OrderService | null = null;
  // Feature 040 — late-bound OrderListService for the customers module.
  let orderListServiceForCustomers: import('../../src/modules/orders/services/order-list-service.js').OrderListService | null = null;
  // Feature 026 US4 / 056 — which organizations a sales-rep admin may see.
  // T143a — `organizations`' port, read lazily, where this harness used to
  // build its own `SalesRepAssignmentService` **without** the subtree deps
  // production passed, and then not use even that: the scope resolver below ran
  // raw SQL over `organization_sales_rep_assignments`. Two divergences from
  // production in one seam, and between them feature 056's roll-up was
  // exercised by nothing.
  // T143a — `customer_accounts`' social-login port, read lazily (see the note
  // on `mfaSocialAccountResolvers` below).
  const customerSocialLogin = (): {
    resolveByEmail(email: string): Promise<{ id: string } | null>;
    autoCreate(email: string): Promise<{ id: string } | null>;
  } =>
    (container.cradle as never as {
      customerSocialLoginPort: {
        resolveByEmail(email: string): Promise<{ id: string } | null>;
        autoCreate(email: string): Promise<{ id: string } | null>;
      };
    }).customerSocialLoginPort;

  const salesRepScope = (): {
    listAssignedOrganizationIds(adminUserId: string): Promise<string[]>;
  } =>
    (container.cradle as never as {
      organizationSalesRepScopePort: {
        listAssignedOrganizationIds(adminUserId: string): Promise<string[]>;
      };
    }).organizationSalesRepScopePort;

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
    return {
      allowAll: false,
      allowedOrganizationIds: await salesRepScope().listAssignedOrganizationIds(actor.adminUserId),
    };
  };

  // Feature 042 / D-96 — the MFA login port is **not** contributed here any
  // more, and that removal is the precondition for every `mfa` off-state
  // assertion in the tree.
  //
  // This harness used to resolve `mfaLoginPort` off the cradle once, at
  // composition, and hand both login consumers a getter returning the captured
  // value. A captured gate goes on answering after an operator switches the
  // module off, so the harness failed **open** where production failed closed:
  // an off-state test written against it passed while measuring a module that
  // was still running (the shape issue #141 found four times). `admin_users`
  // and `customer_accounts` resolve the port for themselves now, through
  // `lazyPort` behind an `effectiveState.isPresent('mfa')` probe, so both
  // composition roots contribute nothing for this name and the harness observes
  // exactly what production does.


  // Feature 056 — organization tree + inheritance resolution, built here for
  // the same reason production builds it (`composition.ts`): three consumers
  // read it, and without it all three run a shape no deployment runs.
  //
  // The credit-mode closure reads Settings at **call** time, so it may be
  // written before the settings module exists further down — which is exactly
  // how production orders it. Feature 072 (T072).

  // Credit-limits module — its CreditLimitService is the driver passed into
  // commerceModule below so OrderService.placeOrder can reserve atomically.
  // Feature 072 (T101) — `credit_limits` owns its service and routes now, and
  // since T143c the return-settlement top-up as well, so this harness reads
  // nothing of the module.

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

  // Feature 072 (T112) — `dictionaries` owns its services, its cache
  // invalidation listeners and its routes now.

  // Registered here rather than with the other host values further down:
  // `addresses` reads it to build the one `AddressService`, and both `orders`
  // and `organizations` are constructed before that block runs.
  // Feature 072 (T090) — one `AddressService` for the whole composition.
  // `orders` and `organizations` used to build their own, and the constructor's
  // validator and audit writer are optional, so the instances were free to
  // disagree — and one did.

  // Feature 072 (wave 1) — `dictionaries` reacts to a currency change instead
  // of `currencies` calling into it. The direction matters: declaring the call
  // as a dependency produced a real cycle, and the cycle was the design saying
  // a currency must not know a dictionary cache exists.
  // Feature 072 (T105) — the language half of the same drop. `languages` used
  // to pass a hard-coded `undefined` for its invalidator, so a deactivated
  // language kept validating for up to the validator's 60 s TTL and kept being
  // served from the Redis dictionary cache for up to an hour, while a currency
  // change dropped both immediately.

  // Feature 072 (T110) — the channel-resolution names. The kernel itself is
  // composed above `composeModules`, for the subscriber ordering; what belongs
  // here is the registration, in the one contribution slot.
  composedModules.contribute({
    salesChannelsCache: salesChannels.cache,
    salesChannelMembershipPort: salesChannels.membershipService,
    // Mirrors `composition.ts`: the real resolver, so a test can reach the
    // channel-scoped stock read at all. Registering it only in production is
    // what let the missing registration survive — see the note there.
    salesChannelResolutionPort: salesChannels.resolver,
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
  // Feature 072 (T127) — `price_lists` owns its services and routes now. The
  // harness drives the status worker through `internal/sweep`, so a wall-clock
  // interval would only add spurious writes mid-run, and it disables the
  // pricing LRU because a test writes a price and reads it back in the same
  // breath. Production keeps the sweeper on and takes the module's own default
  // TTL, which it stopped restating in T143a — so the 0 below is now the only
  // opinion either composition holds about this cache.
  composedModules.contribute({
    priceListsEnableStatusSweeper: false,
    priceListsPricingCacheTtlMs: 0,
    priceListsAdminAuditContext: (request: FastifyRequest) => ({
      actorAdminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
  });

  // Taxes (T128 / FR-051) + Promotions (T129 / FR-052).
  // Feature 072 (T119) — `taxes` owns its service and routes now.
  const taxesCradle = container.cradle as unknown as TaxesCradle;
  // Feature 072 (T115) — `promotions` owns its services and routes now.
  // These three stay here: the org-status gate and the Rule Builder picker
  // sources read `organizations`, `categories`, `payment_methods` and
  // `delivery_methods` directly, and the catalog read port is `catalog`'s.
  // Registered after `composeModules`, where the module declares its defaults.
  composedModules.contribute({
    organizationStatusResolver: async (orgId: string) => {
      const row = (await em().getKnex()
        .raw(`select "status" from "organizations" where "id" = ? and "deleted_at" is null`, [orgId])) as { rows: Array<{ status: string }> };
      return row.rows[0]?.status ?? null;
    },
    promotionRuleTargets: {
      salesChannels: async () => {
        const { items } = await (container.cradle as unknown as SalesChannelsCradle).salesChannelsService.list({});
        return items.map((c) => ({ id: c.id, code: c.code, name: testAnyLabel(c.name) }));
      },
      customerGroups: async () => {
        const groups = await (container.cradle as unknown as CustomerAccountsCradle).customerGroupService.list();
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
  // Feature 072 (T120) — `transactional_emails` owns the binding now and
  // publishes both services as accessor ports; this root reads them like any
  // other consumer instead of holding the variables its callbacks filled in.
  const emailCradle = (): {
    transactionalEmailSenderAccessor: () => import('@b2b/contracts').TransactionalEmailSender | undefined;
    emailBrandingAccessor: () => { resolve(salesChannelId: string): Promise<unknown> } | undefined;
  } => container.cradle as never;

  // Feature 062 — read-only inventory accessors backing the external catalog
  // namespace's availability indication (mirrors composition.ts).

  const modules: ModulePlugin[] = [
    // Feature 072 — every module's route contribution, in the generated order,
    // ahead of the root plugins for the same reason production keeps them
    // there (D-45).
    ...composedModules.sink.plugins,
    // Feature 072 (T078) — `auth`'s root plugin, at the same point in the boot
    // order `composition.ts` puts it: before everything that reads
    // `request.actor`.
    //
    // It registers **before** `registerTestAuth`, so its `onRequest` hook runs
    // first and the harness's synthetic actor still wins. That ordering is the
    // whole compatibility story: `auth` decorates `actor` and seeds it from the
    // real session cookies, and `registerTestAuth` then assigns the test actor
    // over the top through the same decorator.
    async (app) => {
      for (const plugin of composedModules.sink.rootPlugins) await plugin(app);
    },
    async (app) => {
      registerTestAuth(app, {
        sessionService,
        emFactory: em,
        // Feature 062 — mirror production: Bearer sk_live_* resolves to an
        // api_key actor (incl. distributor binding) before the tenant hook
        // and the sales-channel resolver run.
        // The presence probe mirrors `auth/backend.ts` and is load-bearing for
        // the same reason (D-44): `apiKeyService` is a **gated port** read off
        // the live cradle, so with `api_keys` switched off the resolution
        // throws — and this hook runs on every request carrying an
        // `Authorization: Bearer` header, whatever the route. Without it the
        // harness answers 503 to requests production answers normally, and the
        // degradation `auth` declares is untestable here.
        apiKeyResolver: async (token) => {
          if (!effectiveState.isPresent('api_keys')) return null;
          return apiKeysCradle.apiKeyService.authenticate(token);
        },
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
          // T143c — the module's one tree service, resolved per request as
          // production resolves it. This harness built a **second** one here,
          // per request, and being its own it walked the subtree with
          // `organizations` switched off — the roll-up rule answering out of a
          // module the platform was refusing to serve.
          const rollupSubtree = await resolveCustomerRollupSubtreeIds(
            em,
            (id) =>
              (
                container.cradle as never as {
                  organizationTreeService: { subtreeIds(id: string): Promise<string[]> };
                }
              ).organizationTreeService.subtreeIds(id),
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
  ];

  // Feature 072 (T118) — the settings names. The kernel itself is composed
  // above `composeModules`, for the subscriber ordering; what belongs here is
  // the registration, in the one contribution slot.
  composedModules.contribute({
    settingsSecretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'],
    // Mirrors composition.ts: the effective-state reader that classifies each
    // setting and refuses writes an absent module owns.
    settingsModulePresence: {
      presenceOf: (moduleId: string) => effectiveState.presenceOf(moduleId),
      activationControlOwner: (code: string) => effectiveState.activationControlOwner(code),
    },
  });
  // Feature 042 — MFA module (mirrors composition.ts). Built after `settings`
  // so it can read MFA settings; its login port is resolved by the two login
  // consumers themselves (D-96), so nothing is captured here.
  // Feature 072 (T096) — `mfa` owns its services, routes and configuration.
  // What this harness still owns is the actor shape: it authenticates through
  // `request.testActor` where production uses `request.actor`, which is exactly
  // why the bridge is contributed rather than built into the module.
  composedModules.contribute({
    // D-48 — the system-default channel, which always exists.
    mfaDefaultChannelIdResolver: async () =>
      (await salesChannels.resolver.getSystemDefault()).id,
    mfaBaseUrls: {
      backend: 'http://localhost',
      storefront: 'http://localhost:3000',
      admin: 'http://localhost:3002',
    },
    // Feature 042 US4/US5 — deterministic fake provider. `exchangeCode` derives
    // the identity from the `code` query so tests control the resolved email;
    // `unverified@example.com` simulates an unverified provider email.
    mfaOauthProvider: fakeOAuthProvider,
    // T143a — the two customer-side resolvers forward to `customer_accounts`'
    // port, as production's do. What this harness wrote instead was the
    // degraded copy of the pair: no system scope on the read, no
    // `customers.allow_registration_without_organization` gate on the create
    // (so federated sign-in auto-created an account here whatever the operator
    // had configured), and one fixed password hash for every account it made.
    mfaSocialAccountResolvers: {
      resolveCustomerByEmail: (email: string) => customerSocialLogin().resolveByEmail(email),
      autoCreateCustomer: (email: string) => customerSocialLogin().autoCreate(email),
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
  modules.push(salesChannels.plugin);

  // Feature 019 — Admin UI i18n. Feature 072 (T089) — `_i18n` owns its service,
  // reconciler and routes now. Issue #158 — and it is handed the resolved
  // manifest registry (`harnessManifestRegistry`), so the boot-time reconciler
  // runs here exactly as it does in production and every module's bundles are
  // installed. This block used to say the opposite, and the emptiness it
  // described was the reason no test in the tree exercised a translated error
  // message.
  const adminI18nCradle = container.cradle as unknown as AdminI18nCradle;

  // Feature 020 — Admin Command Palette actions registry. Mounts the
  // GET /api/v1/admin/admin-actions read endpoint. Tests that need
  // module_actions rows seed them directly via `h.em()`.
  // Feature 072 (T099) — `admin_actions` owns its service, its reconcile and
  // its routes now. The operator presence axis stays a root's to supply:
  // which modules a deployment ships is not this module's business.
  composedModules.contribute({
    moduleActivationProbe: (moduleId: string) =>
      effectiveState.presence(moduleId)?.operatorActivated ?? true,
  });

  // Feature 058 — Credentials module.
  //
  // Feature 072 (T143a) — the four configuration-type registrations are gone
  // from here, and with them the `isRegistered` guards each one needed. This
  // harness mirrored `composition.ts` by hand, and the mirror was **worse than
  // the original in two ways**: it re-registered core descriptors on a
  // process-wide singleton once per composition, guarding each one so the
  // duplicate did not warn, and the comments record two features (068, 070)
  // where a type registered only in production made every write against it fail
  // misleadingly until somebody added the mirroring line here. Each type is
  // declared by the module that owns it now, from that module's boot hook, so
  // there is one registration and both compositions get it.
  //
  // What stays is how an admin actor is resolved from a request, which the two
  // compositions genuinely answer differently.
  composedModules.contribute({
    adminContextResolver: (request: FastifyRequest) => ({
      adminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
    credentialsSettingsPort: settings.settingsService,
  });
  const credentialsService = (
    container.cradle as unknown as { credentialsService: CredentialsService }
  ).credentialsService;

  // Feature 013 — Assets Library. Routes mount under /api/v1/admin/assets/*
  // and /assets/file/:assetId.
  // Feature 072 (T092) — the module owns its plugin and its registry now.
  // T143a — and each of `catalog`, `cms` and `megamenu` pushes its own
  // reference descriptors from its boot hook, so neither root decides which
  // edges block an asset delete.
  const assetsLibrary = (container.cradle as unknown as AssetsLibraryCradle).assetsLibrary;

  // Feature 046 — PWA module (mirrors composition.ts). runWorkers:false so no
  // BullMQ consumer starts in tests; the delivery processor is invoked directly
  // by integration tests.
  // Feature 072 (T116) — `pwa` owns its services, its queue and its routes
  // now. What stays here is every way it reaches outside itself, contributed
  // as one bridge: a composition knows how to reach `assets_library` and
  // `sales_channels`, or it does not.
  composedModules.contribute({
    // The harness has a producer and no consumer: it enqueues so the routes can
    // assert the queued ack, and starting a delivery worker per test file would
    // be a BullMQ consumer nothing ever closes.
    pwaRunWorkers: false,
    pwaBridge: {
      assetUpload: {
        upload: async (input) => {
          const detail = await assetsLibrary.handle.service.upload(input);
          return { id: detail.id };
        },
      },
      resolveAssetUrl: async (assetId: string) => {
        try {
          return (await assetsLibrary.handle.service.resolveUrl(assetId)).url;
        } catch {
          return null;
        }
      },
      resolveChannelIdByCode: async (code: string | undefined) => {
        if (code) {
          const ch = await salesChannels.resolver.getByCode(code);
          if (ch) return ch.id;
        }
        return (await salesChannels.resolver.getSystemDefault()).id;
      },
      defaultChannelId: async () => (await salesChannels.resolver.getSystemDefault()).id,
      channelCodeForId: async (channelId: string) => {
        const ch = await em().findOne(SalesChannel, { id: channelId });
        return ch?.code ?? null;
      },
      resolveAuditContext: (request: FastifyRequest) => ({
        actorAdminUserId:
          request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
      }),
      resolveCustomerAccountId: async (request: FastifyRequest) =>
        request.testActor?.kind === 'customer' ? request.testActor.customerAccountId : null,
      resolveOrderTarget: async (payload: {
        orderId: string;
        salesChannelId: string;
        from: string;
        to: string;
      }) => {
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
    } satisfies PwaBridge,
  });
  const pwaCradle = container.cradle as unknown as PwaCradle;

  // Feature 015 — Megamenu module. Wires the cross-module ports the
  // target validator + storefront resolver delegate to. v1 uses small
  // direct SQL lookups instead of forcing new upstream surfaces.
  // Feature 072 (T107) — `megamenu` owns its services and routes now. These
  // two bundles stay here: both are existence checks and URL lookups against
  // OTHER modules' tables, so moving them into the module would give it
  // direct reads of `catalog`, `cms` and `assets_library` storage.
  //
  // Registered after `composeModules`, where `megamenu` declares its own
  // defaults — contributing earlier would let the module overwrite the root.
  composedModules.contribute({
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
  // T143a — `megamenu` cross-registers into `cms`' reference registry from its
  // own boot hook now, so this root only drops the cache a previous
  // composition in the same process may have left in Redis.
  const megamenuCradle = container.cradle as unknown as MegamenuCradle;
  if (megamenuCradle.megamenuServices.cache) {
    await megamenuCradle.megamenuServices.cache.invalidateAll();
  }

  // Feature 072 — the host names, mirroring `composition.ts`. They are the only
  // thing this root knows about the modules it composes.
  composedModules.contribute({
    // `requireAdmin` is NOT here: `auth` provides it as a port (T078).
    // `apiKeyResolver` is NOT here either: `api_keys` provides it as a gated
    // port (T100), and re-registering the name replaced that gate with a plain
    // closure — API-key authentication kept working after the module was
    // switched off. Both roots carried the entry until the root-registration
    // check started reading them (T118).
    // `redis` is registered further up, where the client is created.
    settingsReadPort: settings.settingsService,
    // Issue #45 — the same cache, seen from the writing side. Mirrors the root.
    settingsCache: settings.cache,
    // Feature 072 (T093) — `composition.ts` has registered this since T086;
    // the harness passed the same object to `searchModule` as an option but
    // never registered it, so `cms`' colour-palette writer had nothing to
    // resolve. Mirroring the root is the point of this block.
    // `requireCustomer` is NOT here any more: `auth` provides it as a port
    // (issue #43). This harness contributed `requireTestCustomer()` — a second
    // implementation that read `request.testActor` where the root read
    // `request.actor`, so every customer route was gated by one guard in
    // production and a different one under test. `registerTestAuth` mirrors
    // each resolved actor onto both properties, which is why the surviving
    // implementation answers correctly here without reading `testActor`.
    // Feature 072 (wave 2) — mirrors `composition.ts`.
    customerContextResolver: customerResolver,
    // Feature 072 (wave 3) — how this composition names the calling customer as
    // an id. The four payment gateways read it; before their conversion this
    // harness composed none of them, which `harness-parity` recorded as an
    // accepted divergence.
    customerAccountIdResolver: (req: FastifyRequest) =>
      req.testActor?.kind === 'customer' ? req.testActor.customerAccountId : TEST_CUSTOMER_ID,
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
        (await salesChannels.resolver.getByCode(code))?.id ?? null,
      codeById: async (id: string) => {
        const { items } = await (container.cradle as unknown as SalesChannelsCradle).salesChannelsService.list({});
        return items.find((c) => c.id === id)?.code ?? null;
      },
    },
    // Mirrors the production root exactly (feature 072, D-41/D-48): the
    // system-default channel's id. Both used to fall back to `'default'`, a
    // channel *code* that cannot address a `setting_values` row, and then to
    // `?? null` on a branch the platform guarantees against.
    settingsChannelResolver: async (): Promise<string | null> =>
      (await salesChannels.resolver.getSystemDefault()).id,
    blogStorefrontDeps: undefined,
  });
  // `audit_logs` registers its own empty default for `auditActorResolver`, so a
  // value written before `composeModules` would be overwritten by it (the same
  // trap `prompt_actions` hit).
  composedModules.contribute({
    // Feature 072 (T117) — composition-specific sitemap tuning: regeneration is
    // deterministic with no staleness window, and a fixed base URL gives the
    // assertions something stable. Production contributes nothing and takes the
    // module's own `{}`.
    //
    // Registered **after `composeModules`** on purpose. `seo` registers its own
    // `{}` default there, so contributing earlier would have the module
    // overwrite the root — which is exactly what happened, and the sitemap
    // silently fell through to `http://localhost:3000`.
    sitemapOptions: { staleAfterMs: 0, baseUrl: 'http://test.local' },
    lifecycleManifestRegistry: () => harnessManifestRegistry(),
    // Feature 072 (T121) — the gate is the port's own now: `adminUserService`
    // is provided by `admin_users` and raises `ModuleDisabledError` when that
    // module is off, so no root hard-codes `isPresent('admin_users')` here.
    // The contribution itself stays a root's: `audit_logs` owns the name and
    // defaults it absent, and it composes after `admin_users`, so a
    // registration from the module would be overwritten by that default.
    auditActorResolver: async (ids: string[]) => {
      const users = await (
        container.cradle as unknown as AdminUsersCradle
      ).adminUserService.listByIds(ids);
      return users.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
      }));
    },
  });
  // Feature 072 (T137) — contributed in the one slot, between `composeModules`
  // and `runBootHooks()`. Before `composeModules` is too early (the module
  // registers its own `{}` default when it composes, and overwrites this);
  // after `runBootHooks()` is too late (the boot reconcile has already
  // constructed the module and read the default).
  //
  // What it substitutes: `taxonomyDataRoot` is deliberately a path that does not
  // exist, so the boot reconcile never reads the shipped ~1.5 MB taxonomy files;
  // the fetcher and delivery adapters refuse by default, so a code path that
  // starts reaching outward without a test opting in shows up as a failed check
  // rather than a real request.
  composedModules.contribute({
    // Same window, same reason, and here it is a latent *outbound request*
    // rather than a file read: `pim_ergonode`'s boot hook only skips
    // constructing the module because `pimErgonodeRunWorkers` is false in this
    // harness. The day a non-worker reconcile is added there, or one suite
    // flips that flag, a contribution registered after boot would be silently
    // discarded and a test would open a real socket to Ergonode.
    pimErgonodeSourceOverrides: {
      ergonodeClient: options.ergonodeClient ?? refusingErgonodeClient(),
      mediaFetcher: options.ergonodeMediaFetcher ?? new ScriptedErgonodeMediaFetcher(),
    },
    productFeedsTestOverrides: {
      taxonomyDataRoot: '/nonexistent/product-feeds-taxonomies',
      taxonomySourceFetcher: options.taxonomySourceFetcher ?? refusingTaxonomyFetcher(),
      deliveryAdapters: options.feedDeliveryAdapters ?? refusingDeliveryAdapters(),
    },
  });

  // Feature 072 (T136) — `carts` owns its thirteen services and three route
  // files now. What stays a composition's: who is asking (production reads
  // `request.actor`, the harness `request.testActor`), and the bridge into
  // `shopping_lists`, which points outward and so cannot be a port.
  // Feature 072 (T120) — the harness resolves no asset URLs, which is the
  // module's own default; naming it keeps the difference from production
  // visible rather than implied by an omission.
  composedModules.contribute({
    transactionalEmailAssetUrl: async (): Promise<string | null> => null,
  });

  // Feature 072 (T142) — mirrors `composition.ts`. The harness runs no
  // bulk-operation consumer and must not reindex Meilisearch, which is exactly
  // what these two say; the other three are the same adapters, reading this
  // harness's own actor property where one is involved.
  composedModules.contribute({
    catalogRunBulkOperationWorker: false,
    // T143a — deliberately **not** forwarded to `searchReindexPort`, which is
    // what production does now. A `searchable` flag flips in a good number of
    // catalog tests, and forwarding would push every product of every channel
    // into Meilisearch each time. The reindex itself is exercised where it
    // belongs, against the module's own route:
    // `test/contract/search/admin-reindex.contract.test.ts`.
    catalogSearchReindex: async () => ({ documentCount: 0 }),
    catalogAdminAuditContext: (request: FastifyRequest) => ({
      actorAdminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
      impersonatedCustomerAccountId: null,
    }),
    catalogExternalAvailability: async (productIds: string[], salesChannelId: string) => {
      // D-61 — the same presence probe production's contribution makes, and it
      // has to be the same or the off-state test would assert against a
      // composition production does not run. `catalog` declares the degrade as
      // `degrades-without`: no `inventory`, no availability band.
      if (!effectiveState.isPresent('inventory')) {
        return new Map<string, ProductAvailability>();
      }
      return inventoryCradle().inventoryAvailabilityPort.resolveAvailabilityBands(
        productIds,
        salesChannelId,
      );
    },
    catalogImagePlaceholderUrl: async (salesChannelCode?: string) => {
      try {
        const channelId =
          (salesChannelCode ? await salesChannels.resolver.getByCode(salesChannelCode) : null)?.id ??
          (await salesChannels.resolver.getSystemDefault()).id;
        const url = await settings.settingsService.get(
          'product_image_placeholder_url',
          channelId,
          z.string(),
        );
        const trimmed = url.trim();
        return trimmed === '' ? null : trimmed;
      } catch {
        return null;
      }
    },
  });

  // Feature 072 (T141) — mirrors `composition.ts`: the sales-rep admin scope
  // (reading this harness's own actor property) and the late-bound sender.
  composedModules.contribute({
    ordersAdminScopeResolver: resolveTestAdminOrdersScope,
  });

  composedModules.contribute({
    // The organization transact guard used to be a no-op here, named
    // explicitly so the divergence stayed visible. T138 removed it: the guard
    // is `organizationReadPort.assertCanTransact` now, provided by the module
    // and resolved identically by both compositions.
    cartActorResolver: (request: FastifyRequest) => {
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
    cartShoppingListBridge: {
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
    } satisfies CartShoppingListBridge,
  });

  // Feature 043 / 072 — the assistant's contribution points, mirroring
  // `composition.ts`. They are registered **after `composeModules`** because the
  // module registers its own empty defaults there; a value written before
  // composition would be overwritten by them.
  //
  // The tools themselves are no longer here: since D-44 each contributing module
  // pushes its own from its own boot hook, which is also how the `orders` tools
  // — production-only until then — came to be composed in this harness at all.
  // Nor is the bulk-progress reader, since D-72 point 4 turned the single name
  // it was written over into a registry keyed by contributing module. What is
  // left is three test seams, which are this harness's own.
  composedModules.contribute({
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
  const promptActionsCradle = (): PromptActionsCradle =>
    container.cradle as unknown as PromptActionsCradle;

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
  // Feature 072 (T123) — `search` owns its services and routes now. The
  // harness runs no reindex sweep: it has no worker role, and a periodic
  // Meilisearch pass per test file is exactly what `enableReindexScheduler`
  // exists to keep out.
  composedModules.contribute({
    searchRunWorkers: false,
    // T143a — the same statement for `webhooks`' delivery consumer, which the
    // harness has never run: production built it in `composition.ts` and this
    // file simply did not, so the difference was an omission rather than a
    // decision. It is a decision now, and it is the same one every other
    // `*RunWorkers` flag makes here — a BullMQ consumer per test file would
    // hold a Redis connection ~555 times over.
    webhooksRunWorkers: false,
  });

  // Feature 072 (T129) — mirrors `composition.ts`. The harness used to pass no
  // event bus, channel resolver or settings reader to this module at all, so
  // three of its behaviours were exercised by nothing; the module reads all
  // three from the container now.
  composedModules.contribute({
    // Feature 072 (T138) — the admin-editable sender `organizations` sends its
    // verification, invitation and new-registration emails through. A getter
    // because `transactional_emails` announces the sender well after this
    // point; same shape and owner as `inventoryTemplateEmail`.
    inventoryAdminAuditContext: (request: FastifyRequest) => ({
      actorAdminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
  });

  // Feature 007 — Comparisons module. Customer-facing CRUD endpoints
  // exercised by US1 contract + integration tests; share/PDF/admin land
  // in subsequent stories.
  // Feature 072 (T111) — `comparisons` owns its services and routes now.
  const comparisonsCradle = container.cradle as unknown as ComparisonsCradle;

  // Feature 008 — Quote Requests workflow.
  // Feature 072 (T132) — `quote_requests` owns its services, routes and the
  // four settings reads now. What stays is a composition's answer to who is
  // asking, the organization's tax rate, and the subtree the RFQ admin scope
  // rolls up over.
  composedModules.contribute({
      rfqCustomerContextResolver: async (request: FastifyRequest) => {
        const ctx = customerResolver(request);
        const account = await em().findOne(CustomerAccount, { id: ctx.customerAccountId });
        return {
          customerAccountId: ctx.customerAccountId,
          organizationId: ctx.organizationId,
          isOrgAdmin: account?.role === 'organization_admin',
        };
      },
      rfqAdminContextResolver: async (request: FastifyRequest) => {
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
      // No `catch`, exactly as production has none since issue #84 — a harness
      // that swallowed what production propagates would hide the 503 the
      // fail-closed tests exist to observe.
      // T143c — read through `organizations`' port, as production reads it.
      rfqTaxRateResolver: async (organizationId: string) => {
        const org = await (
          container.cradle as never as { organizationTaxProfilePort: OrganizationTaxProfilePort }
        ).organizationTaxProfilePort.taxProfileOf(organizationId);
        const vatStatus = org?.vatStatus ?? 'vat_payer';
        if (vatStatus !== 'vat_payer') return 0;
        const country = org?.country ?? 'PL';
        const resolved = await taxesCradle.taxService.taxRateFor({
          country,
          productType: 'simple',
          vatStatus,
        });
        // Same narrowing production does (issue #124): `none` is "no rule and no
        // default configured", never "no `taxes` module" — that one throws at
        // the port gate before this line runs.
        return resolved.source === 'none' ? 0 : resolved.rate;
      },
  });

  // Feature 072 (T138) — the two `organizations` contributions this harness
  // makes, registered after `composeModules` so they overwrite the module's
  // defaults rather than being overwritten by them. Both are read lazily — the
  // clients when the tax-ID service is first constructed, the hook at login — so
  // this placement is safe.
  composedModules.contribute({
    // No test may open a socket to VIES or Ministerstwo Finansow. The fake
    // returns `validated` for any taxId ending in `00000` and `failed` /
    // `deferred` otherwise, giving three deterministic branches.
    organizationsTaxIdClients: {
      vies: new FakeVatValidator('vies'),
      mfPl: new FakeVatValidator('mf_pl'),
    },
    organizationsLoginHook: async (loginCtx: {
      customerAccountId: string;
      organizationId: string | null;
      anonymousCartToken?: string;
      anonymousCompareToken?: string;
    }) => {
      let result: Record<string, unknown> = {};
      if (loginCtx.anonymousCartToken && loginCtx.organizationId) {
        const cartMerge = await (
          container.cradle as unknown as CartsCradle
        ).cartService.mergeAnonymousIntoCustomer(loginCtx.anonymousCartToken, {
          customerAccountId: loginCtx.customerAccountId,
          organizationId: loginCtx.organizationId,
        });
        result = { cartMerge };
      }
      // Feature 007 — adopt an anonymous comparison carried by the
      // compare_token cookie. Mirrors composition.ts, D-70 included: the
      // presence question is decided here, and the port is resolved **per
      // login** rather than bound once at composition time. The old shape
      // captured `adoptAnonymousComparison` off the cradle while every module
      // was still on, so the gate this harness composed answered `yes` for the
      // rest of the process — the one thing an off-state test of this seam has
      // to be able to see.
      if (loginCtx.anonymousCompareToken && effectiveState.isPresent('comparisons')) {
        await (
          container.cradle as unknown as ComparisonsCradle
        ).comparisonService.adoptAnonymousComparison(
          loginCtx.customerAccountId,
          loginCtx.anonymousCompareToken,
        );
      }
      return result;
    },
  });

  // Feature 040 — Customers module (mirrors composition.ts wiring).
  // Feature 072 (T140) — mirrors `composition.ts`: two names stay this
  // composition's, both actor-shaped.
  //
  // Feature 076 (D-86) — `customersVatValidator` left this contribution. The
  // fake above, contributed once over `organizationsTaxIdClients`, now reaches
  // `customers` through `vatValidatorPort`, so there is no second name for the
  // two roots to keep in step and no way for the two consumers to disagree
  // about the same tax id.
  composedModules.contribute({
    customerActorResolver: (request: FastifyRequest) => {
      if (request.testActor?.kind !== 'customer') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
      }
      return {
        customerAccountId: request.testActor.customerAccountId,
        organizationId: request.testActor.organizationId ?? null,
      };
    },
    customerOrderListServiceGetter: () => {
      if (!orderListServiceForCustomers) {
        throw new Error('OrderListService not yet bound');
      }
      return orderListServiceForCustomers;
    },
    customerModerationActorResolver: async (request: FastifyRequest) => {
      const adminUserId =
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID;
      const adminUser = await em().findOne(AdminUser, { id: adminUserId });
      const role = adminUser?.adminRoleId
        ? await em().findOne(AdminRole, { id: adminUser.adminRoleId })
        : null;
      const isPlatformAdmin = role?.code !== 'sales_representative';
      const allowedOrganizationIds = isPlatformAdmin
        ? []
        : await salesRepScope().listAssignedOrganizationIds(adminUserId);
      return { adminUserId, isPlatformAdmin, allowedOrganizationIds };
    },
  });

  // Feature 046 — Returns & Complaints (Refunds, RMA).
  // Feature 072 (T109) — `returns` owns its services and routes now. T143c —
  // and the four settlement adapters belong to the modules whose money they
  // move, so what this bridge holds is the composition's answers: who is
  // asking, where the notification goes, and in which language.
  const settlementCradle = (): {
    orderReturnContextPort: ReturnsBridge['orderContext'];
    paymentRefundPort: ReturnsBridge['paymentRefund'];
    correctiveInvoicePort: ReturnsBridge['correctiveInvoice'];
    creditTopupPort: ReturnsBridge['creditTopup'];
  } => container.cradle as never;
  composedModules.contribute({
    returnsBridge: {
      resolveCustomerAccountId: (req) =>
        req.testActor?.kind === 'customer' ? req.testActor.customerAccountId : TEST_CUSTOMER_ID,
      resolveAdminUserId: (req) =>
        req.testActor?.kind === 'admin' ? req.testActor.adminUserId : TEST_ADMIN_ID,
      // T143c — the four settlement adapters are their owners' ports, forwarded
      // per settlement exactly as the production root forwards them.
      //
      // The corrective-invoice one is why this ledger was worth building. This
      // harness built its own `InvoiceNumberGenerator` over its own pattern
      // resolver, so every correction number a test drew came out of a counter
      // `invoices` could not see, while production drew from the module's one
      // generator. Nothing failed; the two roots simply numbered corrections
      // differently, and no assertion in the suite could reach the difference.
      orderContext: {
        getReturnContext: (orderId) =>
          settlementCradle().orderReturnContextPort.getReturnContext(orderId),
      },
      paymentRefund: {
        refund: (input) => settlementCradle().paymentRefundPort.refund(input),
      },
      correctiveInvoice: {
        createCorrection: (input) =>
          settlementCradle().correctiveInvoicePort.createCorrection(input),
      },
      creditTopup: {
        creditFromReturn: (input) => settlementCradle().creditTopupPort.creditFromReturn(input),
      },
      // The notifier is `returns`' own class and `returns` builds it since
      // T143c, reading `emailMailer` per send — which is the name this harness
      // already overrides with its spy, so the injected mailer still arrives.
      resolveCustomerEmail: async (cid) =>
        (await em().findOne(CustomerAccount, { id: cid }))?.email ?? null,
      resolveChannelLanguage: async (salesChannelId) =>
        (await em().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage ?? 'en-US',
    } satisfies ReturnsBridge,
  });

  // Feature 047 — Invoices.
  // Feature 072 (T113) — `invoices` owns its services and routes now. What
  // stays here is how this composition reaches outside the module,
  // contributed as one bridge.
  composedModules.contribute({
    invoicesBridge: {
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
      getTransactionalEmailSender: () => emailCradle().transactionalEmailSenderAccessor(),
      resolveRecipientEmail: async (order) =>
        (await em().findOne(CustomerAccount, { id: order.placedByCustomerAccountId }))?.email ?? null,
      resolveLanguage: async (salesChannelId) =>
        (salesChannelId
          ? (await em().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage
          : null) ?? 'en-US',
    } satisfies InvoicesBridge,
  });
  const invoicesCradle = container.cradle as unknown as InvoicesCradle;

  // Feature 059 — KSeF. No redis queue in tests (submissions are processed by
  // driving `submissions.process(...)` directly); the sweep interval is off.
  // Feature 072 (T104) — `ksef` owns its services and routes now.
  composedModules.contribute({
    ksefSellerNipResolver: async () => {
      try {
        const { z: zod } = await import('zod');
        const raw = await settings.settingsService.get('invoices.seller.tax_id', null, zod.string());
        const nip = raw.replace(/^PL/i, '').replace(/[\s-]/g, '');
        return nip.length > 0 ? nip : null;
      } catch {
        return null;
      }
    },
    // The harness substitutes a deterministic client, drives sweeps itself and
    // polls three times at 5 ms. Production contributes nothing and keeps the
    // module's own cadence against the real API.
    ksefTestOverrides: {
      ...(options.ksefClientFactory ? { clientFactory: options.ksefClientFactory } : {}),
      sweepIntervalMs: 0,
      pollAttempts: 3,
      pollIntervalMs: 5,
    },
  });
  const ksefCradle = container.cradle as unknown as KsefCradle;

  // Feature 067 — Product Feed. Deliberately NO `redis` and NO `runWorkers`:
  // `setupBackendServer()` runs once per test file in a single fork, and adding
  // BullMQ connections here has previously taken ~225 files down with "too many
  // clients" (research §R18). Tests drive `productFeeds.generation.generateNow`
  // directly, exactly as the KSeF tests drive `submissions.process`.
  // Feature 072 (T137) — `product_feeds` owns its services and routes now.
  // The four adapters it reaches outside itself through stay a root's: each
  // crosses a boundary the module must not reach through directly.
  composedModules.contribute({
    productFeedsBridge: {
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
      resolveAvailability: async (productIds: string[], salesChannelId: string) =>
        // T143a — `inventory`'s port. This built a fresh `WarehouseChannelService`
        // *and* `StockLevelService` on every call, each with only `em` where the
        // module passes the event bus and audit writer too.
        inventoryCradle().inventoryAvailabilityPort.resolveAvailabilityBands(
          productIds,
          salesChannelId,
        ),
      expandCategoryProductIds: (categoryIds: string[]) =>
        // T143a — `catalog`'s port, mirroring `composition.ts`. This built a
        // throwaway `CatalogQueryService` per call.
        (container.cradle as never as { catalogQueryPort: CatalogQueryService })
          .catalogQueryPort.expandCategoryProductIds(categoryIds),
      resolvePublicImageUrls: async (assetIds: string[]) => {
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
    } satisfies ProductFeedsBridge,
  });
  // Feature 072 (T137) — the template reconcile moved into the module's own
  // `ctx.onBoot`, which runs for both compositions.

  // Feature 068 — Ergonode PIM. Deliberately NO `redis` and NO `runWorkers`,
  // for the same reason product_feeds above has neither: one fork per test file
  // cannot afford a BullMQ connection per module. Integration tests drive the
  // import pipeline directly rather than through a job.
  //
  // The catalogue write surface is constructed here exactly as production
  // composition builds it, so what a test exercises is the path a real import
  // takes — Command Bus, channel binding and all.
  // Feature 072 (T131) — the eight services `pim_ergonode` reads across a
  // module boundary. Seven are `catalog`'s and were constructed here a
  // second time, purely for this module, while `catalog` built its own;
  // registering them means one instance each per composition. They go when
  // `catalog` and `assets_library` convert.
  composedModules.contribute({
    // Mirrors `composition.ts`: the seven `catalog` services this block built a
    // second time are that module's ports since T142. Only `assets_library`'s
    // is left, and it drains when that module converts.
    assetsLibraryService: assetsLibrary.handle.service,
  });

  // Feature 047 — Transactional Emails.
  // Feature 072 (T126) — `payments` owns the payment-status notifier now and
  // subscribes through `ctx.subscribe`, so it stops when the module does. The
  // sender stays a contribution: `transactional_emails` announces it through a
  // callback this root holds, later than the module composes.
  composedModules.contribute({
    paymentEmailSender: () => emailCradle().transactionalEmailSenderAccessor(),
  });
  // Feature 072 (T124) — `shipments` owns the shipment-created notifier now and
  // subscribes through `ctx.subscribe`, so it stops when the module does. The
  // sender stays a contribution: `transactional_emails` announces it through a
  // callback this root holds, later than the module composes.
  composedModules.contribute({
    shipmentEmailSender: () => emailCradle().transactionalEmailSenderAccessor(),
  });
  modules.push(
  );

  // Feature 072 (T114) — `newsletter` owns its services and routes now.
  // These stay here because they are pinned per composition rather than
  // derived: the token secret and base URLs decide what an unsubscribe link
  // looks like, and the harness needs that predictable.
  composedModules.contribute({
    newsletterBridge: {
      tokenSecret: 'test-newsletter-secret',
      defaultChannelId: (await salesChannels.resolver.getSystemDefault()).id,
      resolveChannelIdByCode: async (code) =>
        (await salesChannels.resolver.getByCode(code))?.id ?? null,
      publicBaseUrl: 'http://localhost',
      storefrontBaseUrl: 'http://localhost',
      resolveCustomerAccountId: (req) =>
        req.testActor?.kind === 'customer' ? req.testActor.customerAccountId : '',
      loadCustomerEmail: async (customerAccountId) =>
        (await em().findOne(CustomerAccount, { id: customerAccountId }))?.email ?? null,
      mailer: injectedMailer,
      emitEvent: (name, payload) =>
        eventBus.emit(name, {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          ...payload,
        }),
    } satisfies NewsletterBridge,
  });

  // Feature 049 — Google Analytics. No redis wired here, so /collect degrades
  // to 503 (queue producer absent); config + admin CRUD are fully exercised.

  // Feature 063 — LinkedIn Ads. Config + mapping CRUD are fully exercised.

  // Feature 064 — Meta Ads. Config + custom-event CRUD are fully exercised.

  // Feature 066 — Google Tag Manager. No redis wired here: a BullMQ queue built
  // per `setupBackendServer()` is never closed, and this harness is constructed
  // once per test file inside a single fork. /collect therefore degrades to 503
  // here (queue producer absent) and is contract-tested against its own bare
  // instance in test/contract/google_tag_manager/collect.test.ts.

  // Feature 072 (T133) — mirrors `composition.ts`. The harness passed no
  // `settingsService` here, so the quick-order import cap fell back to its
  // manifest default in every test while production read it per channel.
  composedModules.contribute({
    oneClickOrderServiceGetter: () => orderServiceForOneClick,
    shoppingListServiceSink: (svc: ShoppingListService) => {
      shoppingListServiceRef = svc;
    },
  });

  if (options.extraModules) modules.push(...options.extraModules);

  // Feature 072 (T125) — `_lifecycle` registers these routes itself now,
  // through `ctx.ungatedRoutes`. What stays here is the one thing that
  // genuinely differs: local refresh goes through the *cache seam* rather than
  // a database read, because this harness never populates
  // `module_registrations` and refreshing from the database would blank the
  // seeded enabled-set and take every gated route down mid-run. No
  // `lifecycleOrchestrator` is contributed, so the module list is not served —
  // which is exactly the composition this harness has always been.
  composedModules.contribute({
    lifecycleActivationPropagation: {
      commandBus,
      propagation: {
        refreshLocalState: () => registryCache.__refreshActivationForTesting(em),
        publishStateChanged: (payload: Parameters<typeof publishStateChanged>[1]) =>
          publishStateChanged(redis, payload),
        revalidateStorefront: async () => undefined,
      },
    },
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
  await new ManifestReconciler(em()).apply(
    collectRegisteredSettingsManifests(REGISTERED_MANIFESTS),
  );

  // The explicit boot phase (FR-021), run **once**, after every registration
  // and every contribution above and immediately before the app is built —
  // exactly where `composition.ts` runs it (D-45). A boot hook may therefore
  // resolve anything this composition registers. It is also what closes the
  // contribution window: a `composedModules.contribute(…)` below this line
  // throws instead of writing a value no hook will read (issue #52).
  await composedModules.runBootHooks();

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
      errorTranslationTargets: ERROR_TRANSLATION_KEYS,
      resolvePreferredLanguage: async (request) => {
        if (request.testActor?.kind !== 'admin') return null;
        const adminUser = await em().findOne(AdminUser, { id: request.testActor.adminUserId });
        return adminUser?.preferredLanguage === 'pl' ? 'pl' : 'en';
      },
      translateErrorMessage: async ({ moduleId, key, language, originalMessage, params }) => {
        const translated = await adminI18nCradle.adminI18nService.translate(
          moduleId,
          key,
          language,
          params,
        );
        return translated === `${moduleId}.${key}` ? originalMessage : translated;
      },
    },
  });
  // Seed the in-process module registry as "all modules enabled". Production
  // loads it from `module_registrations` in `loadModulePresence()`, a
  // composition step in `composeApp()`, but the test harness never boots the
  // lifecycle orchestrator and never populates that table. Without this, every
  // route wrapped in `defineModuleRoutes` (e.g. the entire `blog` surface) 503s
  // with MODULE_DISABLED, and the permission catalogue would report zero
  // enabled modules. Lifecycle tests that need a specific module disabled
  // override this within their own setup.
  // Feature 073 — install the activation declarations the manifests carry.
  // Production does this inside the same load; without it the operator axis has
  // nothing to resolve, the settings write guards never fire and the activation
  // endpoint reports every module as having no control.
  // Feature 072 (D-38) — the seeding above happens before the first module
  // registers, which is the same order production now runs in: presence is a
  // composition input, and `__setEnabledForTesting` is the load without a
  // database.
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
  // `_i18n` reconciles from its `ctx.routes` callback, so the bundles are on
  // disk-truth by the line above. Prove it before any test observes anything —
  // see the note on `assertErrorTranslationsInstalled`.
  await assertErrorTranslationsInstalled(adminI18nCradle.adminI18nService);

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
      registry: promptActionsCradle().promptActionToolRegistry,
      requestService: promptActionsCradle().promptRequestService,
      providerFactory: promptActionsCradle().llmProviderFactory,
    },
    credentials: {
      service: credentialsService,
      // Resolved from the container rather than imported: `credentials`
      // declares the registry it owns since T143a.
      configurationTypeRegistry: (
        container.cradle as unknown as { configurationTypeRegistry: ConfigurationTypeRegistry }
      ).configurationTypeRegistry,
    },
    invoices: {
      invoiceService: invoicesCradle.invoiceService,
      numberGenerator: invoicesCradle.invoiceNumberGenerator,
      pdfRenderer: invoicesCradle.invoicePdfRenderer,
    },
    ksef: ksefCradle.ksef.handle,
    productFeeds: (container.cradle as unknown as ProductFeedsCradle).productFeeds.handle,
    pimErgonode: (container.cradle as unknown as PimErgonodeCradle).pimErgonode.handle,
    pwa: pwaCradle.pwa.handle,
    permissionService,
    permissionCatalogueService,
    settings: {
      ...settings,
      adminService: (container.cradle as unknown as SettingsCradle).settingsAdminService,
      cacheAdminService: (container.cradle as unknown as SettingsCradle)
        .settingsCacheAdminService,
    },
    salesChannels: {
      ...salesChannels,
      salesChannelsService: (container.cradle as unknown as SalesChannelsCradle)
        .salesChannelsService,
    },
    integrations: {
      apiKeyService: apiKeysCradle.apiKeyService,
      requireApiKey: apiKeysCradle.requireApiKey,
      requireBoundApiKey: apiKeysCradle.requireBoundApiKey,
    },
    search: (container.cradle as unknown as SearchCradle).searchHandle,
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
    // T143a — the port `catalog` provides, so a fixture reads the same instance
    // the module does rather than a second one built here.
    get catalogAttributeRead(): CatalogAttributeReadService {
      return (container.cradle as never as { catalogAttributeReadPort: CatalogAttributeReadService })
        .catalogAttributeReadPort;
    },
    // Issue #132 — the same port the listing paths resolve, so a hand-built
    // fixture prices the way the composed catalogue does.
    get pricingService(): PricingServiceContract {
      return (container.cradle as never as { pricingService: PricingServiceContract })
        .pricingService;
    },
    // Feature 075 — the asset read port the catalogue's image resolution goes
    // through. A getter, not a captured value: the registration is gated, so
    // holding it would be holding a gate that keeps answering.
    get assetRead(): AssetReadPort {
      return (container.cradle as never as { assetReadPort: AssetReadPort }).assetReadPort;
    },
    // Feature 072 (T138) — read off the container rather than off a handle the
    // module block used to fill in. The `?? null as unknown as …` fallbacks are
    // gone with it: they existed because the block was conditional, and a test
    // reaching for a service that was never built got `null` masquerading as
    // one rather than a resolution error.
    organizations: {
      get moderationService(): OrganizationModerationService {
        return (container.cradle as never as OrganizationsCradle).organizationModerationService;
      },
      adminNotificationService,
      get organizationContextService(): OrganizationContextService {
        return (container.cradle as never as OrganizationsCradle)
          .organizationReadPort as OrganizationContextService;
      },
      get restrictionService(): OrganizationRestrictionService {
        return (container.cradle as never as OrganizationsCradle).organizationRestrictionPort;
      },
    },
    cartService: () => (container.cradle as unknown as CartsCradle).cartService,
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
