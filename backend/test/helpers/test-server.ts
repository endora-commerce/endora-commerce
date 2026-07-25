import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import Redis from 'ioredis';
import { buildServer, type ModulePlugin } from '../../src/http/server.js';
import { ApiInterceptorRegistry } from '../../src/http/interceptors/index.js';
import { registerApiInterceptorAdminRoutes } from '../../src/modules/_lifecycle/routes.admin.js';
import { forkScopedEm } from '../../src/tenancy/scoped-em.js';
import { runInTenantContext, type TenantContext } from '../../src/tenancy/tenant-context.js';
import {
  resolveTenantContext,
  systemTenantContext,
} from '../../src/tenancy/resolve-tenant-context.js';
import { initOrm, closeOrm } from '../../src/db/index.js';
import { EventBus } from '../../src/events/bus.js';
import { CommandBus } from '../../src/commands/index.js';
import { SessionService } from '../../src/modules/auth/services/session-service.js';
import { AuditLogService } from '../../src/modules/audit_logs/services/audit-log-service.js';
import { PermissionService } from '../../src/modules/admin_roles/services/permission-service.js';
import { PermissionCatalogueService } from '../../src/modules/admin_roles/services/permission-catalogue.service.js';
import { AdminRoleService } from '../../src/modules/admin_roles/services/admin-role-service.js';
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
import { AdminUserService } from '../../src/modules/admin_users/services/admin-user-service.js';
import { i18nModule as adminI18nModule } from '../../src/modules/_i18n/plugin.js';
import { adminActionsModule } from '../../src/modules/admin_actions/plugin.js';
import { AdminRole } from '../../src/modules/admin_roles/entities/admin-role.entity.js';
import { organizationsModule } from '../../src/modules/organizations/plugin.js';
import { adminNotificationsModule } from '../../src/modules/admin_notifications/plugin.js';
import { Organization } from '../../src/modules/organizations/entities/organization.entity.js';
import { OrganizationModerationService } from '../../src/modules/organizations/services/organization-moderation-service.js';
import { OrganizationContextService } from '../../src/modules/organizations/services/organization-context-service.js';
import { OrganizationRestrictionService } from '../../src/modules/organizations/services/organization-restriction-service.js';
import { SalesRepAssignmentService } from '../../src/modules/organizations/services/sales-rep-assignment-service.js';
import { OrganizationTreeService } from '../../src/modules/organizations/services/organization-tree-service.js';
import { resolveCustomerRollupSubtreeIds } from '../../src/modules/customer_accounts/services/customer-rollup-scope.js';
import { OrganizationEffectivePriceListsService } from '../../src/modules/organizations/services/organization-effective-pricelists-service.js';
import { OrganizationTaxIdValidationService } from '../../src/modules/organizations/services/organization-tax-id-validation-service.js';
import type {
  VatValidator,
  VatValidationResult,
} from '../../src/modules/organizations/services/vat-validator-port.js';
import { OrgRegistrationNotifier } from '../../src/modules/organizations/services/org-registration-notifier.js';
import type { OrganizationEventBus } from '../../src/modules/organizations/services/registration-service.js';
import { ConsoleMailer } from '../../src/modules/email/services/mailer.js';
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
import { newsletterSettingsManifest } from '../../src/modules/newsletter/manifest.js';
import { googleAnalyticsModule } from '../../src/modules/google_analytics/plugin.js';
import { googleAnalyticsSettingsManifest } from '../../src/modules/google_analytics/manifest.js';
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
import { creditLimitsModule } from '../../src/modules/credit_limits/plugin.js';
import { customFieldsModule } from '../../src/modules/custom_fields/plugin.js';
import { integrationsModule } from '../../src/modules/api_keys/plugin.js';
import { analyticsModule } from '../../src/modules/analytics/plugin.js';
import { importExportModule } from '../../src/modules/import_export/plugin.js';
import { seoModule } from '../../src/modules/seo/plugin.js';
import { i18nModule } from '../../src/modules/languages/plugin.js';
import { cmsModule } from '../../src/modules/cms/plugin.js';
import { megamenuModule } from '../../src/modules/megamenu/plugin.js';
import { registerMegamenuAssetReferences } from '../../src/modules/megamenu/services/asset-references.js';
import { registerMegamenuCmsReferences } from '../../src/modules/megamenu/services/cms-references.js';
import { blogModule } from '../../src/modules/blog/plugin.js';
import { dictionariesModule } from '../../src/modules/dictionaries/plugin.js';
import { priceListsModule } from '../../src/modules/price_lists/plugin.js';
import { taxesModule } from '../../src/modules/taxes/plugin.js';
import { promotionsModule } from '../../src/modules/promotions/plugin.js';
import { settingsModule } from '../../src/modules/settings/plugin.js';
import { settingsManifest as settingsModuleManifest } from '../../src/modules/settings/manifest.js';
import { mfaModule } from '../../src/modules/mfa/plugin.js';
import { mfaSettingsManifest } from '../../src/modules/mfa/manifest.js';
import { hashPassword } from '../../src/modules/auth/services/password-hasher.js';
import type { MfaLoginPort } from '../../src/modules/auth/services/mfa-login-port.js';
import type { OAuthProviderPort } from '../../src/modules/mfa/services/oauth-provider-service.js';
import { salesChannelsModule } from '../../src/modules/sales_channels/plugin.js';
import { searchModule } from '../../src/modules/search/plugin.js';
import { createSuggestionPricingEnricher } from '../../src/modules/search/services/suggestion-pricing-enricher.js';
import { searchManifest } from '../../src/modules/search/manifest.js';
import { promptActionsModule, type PromptActionsModuleOptions } from '../../src/modules/prompt_actions/plugin.js';
import { promptActionsSettingsManifest } from '../../src/modules/prompt_actions/manifest.js';
import { credentialsModule } from '../../src/modules/credentials/plugin.js';
import { ksefModule } from '../../src/modules/ksef/plugin.js';
import type { KsefApiClientPort } from '../../src/modules/ksef/integrations/ksef-client.interface.js';
import { configurationTypeRegistry } from '../../src/modules/credentials/services/registry-singleton.js';
import { llmConfigurationType } from '../../src/modules/credentials/types/llm.type.js';
import { emailAdapterConfigurationType } from '../../src/modules/credentials/types/email-adapter.type.js';
import { pwaModule } from '../../src/modules/pwa/plugin.js';
import { pwaSettingsManifest } from '../../src/modules/pwa/manifest.js';
import { transactionalEmailsSettingsManifest } from '../../src/modules/transactional_emails/manifest.js';
import { invoicesSettingsManifest } from '../../src/modules/invoices/manifest.js';
import { ksefSettingsManifest } from '../../src/modules/ksef/manifest.js';
import { SalesChannel } from '../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { Order } from '../../src/modules/orders/entities/order.entity.js';
import {
  catalogBulkProgressResolver,
  catalogPromptMutationTools,
  catalogPromptResolverTools,
} from '../../src/modules/catalog/prompt-tools.js';
import { inventoryPromptTools } from '../../src/modules/inventory/prompt-tools.js';
import { comparisonsModule } from '../../src/modules/comparisons/plugin.js';
import { comparisonsManifest } from '../../src/modules/comparisons/manifest.js';
import { quoteRequestsManifest } from '../../src/modules/quote_requests/manifest.js';
import { inventoryManifest } from '../../src/modules/inventory/manifest.js';
import { priceListsManifest } from '../../src/modules/price_lists/manifest.js';
import { assetsLibraryModule } from '../../src/modules/assets_library/plugin.js';
import { assetsLibraryManifest } from '../../src/modules/assets_library/manifest.js';
import { blogManifest } from '../../src/modules/blog/manifest.js';
import { registerCatalogAssetReferences } from '../../src/modules/catalog/services/asset-references.js';
import { registerCmsAssetReferences } from '../../src/modules/cms/services/asset-references.js';
import { CatalogQueryService } from '../../src/modules/catalog/services/catalog-query.service.js';
import { CatalogAttributeReadService } from '../../src/modules/catalog/services/catalog-attribute-read.service.js';
import { DefaultChannelReconciler } from '../../src/modules/sales_channels/services/default-channel-reconciler.js';
import { ManifestReconciler } from '../../src/modules/settings/services/manifest-reconciler.js';
import type { CartService } from '../../src/modules/carts/services/cart-service.js';
import type { Mailer } from '../../src/modules/email/services/mailer.js';
import { seedUs1Catalog } from './seed-catalog.js';
import { seedTestOrganizations } from './seed-organizations.js';
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
  promptActionsLlmFetch?: PromptActionsModuleOptions['llmFetch'];
  promptActionsNow?: () => Date;
  promptActionsTtlMinutes?: number;
  /** Feature 059 — stub KSeF API client for submission/credential tests. */
  ksefClientFactory?: (baseUrl: string) => KsefApiClientPort;
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
  sessionService: SessionService;
  auditLogService: AuditLogService;
  permissionService: PermissionService;
  permissionCatalogueService: PermissionCatalogueService;
  /** Feature 004 — exposes the universal getter and cache invalidator for tests. */
  settings: ReturnType<typeof settingsModule>['handle'];
  /** Feature 043 — prompt assistant handle (registry + request service). */
  promptActions: ReturnType<typeof promptActionsModule>['handle'];
  /** Feature 058 — credentials handle (config-type registry + service). */
  credentials: ReturnType<typeof credentialsModule>['handle'];
  /** Feature 047 — invoices handle (issuance service, PDF renderer, number generator). */
  invoices: ReturnType<typeof invoicesModule>['handle'];
  /** Feature 059 — KSeF handle (settings, auth, credentials, submissions). */
  ksef: ReturnType<typeof ksefModule>['handle'];
  /** Feature 046 — PWA handle (config resolver, push services, delivery queue). */
  pwa: ReturnType<typeof pwaModule>['handle'];
  /** Feature 005 — exposes the resolver, membership service, and CRUD service. */
  salesChannels: ReturnType<typeof salesChannelsModule>['handle'];
  /** Feature 062 — api-keys/webhooks/integrations handle (api-key gates). */
  integrations: ReturnType<typeof integrationsModule>['handle'];
  /** Feature 006 — exposes the indexer + suggest service for tests that
   *  want deterministic teardown or to exercise embedder attach/detach. */
  search: ReturnType<typeof searchModule>['handle'];
  /** Feature 007 — exposes the ComparisonService for tests. */
  comparisons: ReturnType<typeof comparisonsModule>['handle'];
  /** Feature 013 — Assets Library handle (service, folders, registry, adapters). */
  assetsLibrary: ReturnType<typeof assetsLibraryModule>['handle'];
  /** Feature 014 — CMS module handle (page builder registry, services, resolver). */
  cms: ReturnType<typeof cmsModule>['handle'];
  /** Feature 015 — Megamenu module handle (reference registry, cache). */
  megamenu: ReturnType<typeof megamenuModule>['handle'];
  /** Feature 016 — Blog module handle (cache, settings resolver, reconcile). */
  blog: ReturnType<typeof blogModule>['handle'];
  /** Feature 017 — Dictionary module handle (cache + future validator). */
  dictionaries: ReturnType<typeof dictionariesModule>['handle'];
  /** Feature 021 — error-envelope i18n bridge. */
  adminI18n: ReturnType<typeof adminI18nModule>['handle'];
  /** Feature 015+ — promotions module handle (exposes PromotionService). */
  promotions: ReturnType<typeof promotionsModule>['handle'];
  /** Feature 055 — custom fields (definition + value services). */
  customFields: ReturnType<typeof customFieldsModule>['handle'];
  /** Feature 061 — the composed attribute read model (definition + extension views). */
  catalogAttributeRead: CatalogAttributeReadService;
  /** Feature 026 — moderation lifecycle, admin notifications, org context. */
  organizations: {
    moderationService: OrganizationModerationService;
    adminNotificationService: ReturnType<
      typeof adminNotificationsModule
    >['handle']['adminNotificationService'];
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
  'external_integrations',
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

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
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

  const sessionService = new SessionService(em, redis);
  const auditLogService = new AuditLogService(em);
  const permissionService = new PermissionService(em);
  const permissionCatalogueService = new PermissionCatalogueService({
    registryEntries: REGISTERED_MANIFESTS,
  });
  const adminRoleService = new AdminRoleService(em, permissionCatalogueService);
  const requireAdminAny = requireTestAdminAny(permissionService);

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

  // Standalone AdminUserService for modules that need direct service-level
  // access to admin users (feature 019 — wires the preferred-language
  // setter into the i18n module's PATCH route).
  const testAdminUserService = new AdminUserService(em);

  // Feature 042 — late-bound MFA login port (the MFA module is built after
  // `settings` below; mirrors composition.ts).
  let testMfaLoginPort: MfaLoginPort | undefined;
  const getTestMfaLoginPort = (): MfaLoginPort | undefined => testMfaLoginPort;

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

  // Credit-limits module — its CreditLimitService is the driver passed into
  // commerceModule below so OrderService.placeOrder can reserve atomically.
  const creditLimits = creditLimitsModule({
    emFactory: em,
    eventBus,
    commandBus,
    requireCustomer: requireTestCustomer(),
    requireAdmin: requireTestAdmin(permissionService),
    resolveCustomerContext: customerResolver,
  });

  // Feature 055 — Custom Fields Layer. No Redis publisher in tests; the cache
  // uses its in-process map + TTL. The value service is threaded into the
  // organizations module below so org custom-field values validate on edit.
  const customFields = customFieldsModule({
    emFactory: em,
    commandBus,
    requireAdmin: requireTestAdmin(permissionService),
  });

  // Feature 061 — the composed attribute read model (mirrors composition.ts):
  // product-host custom-field definitions + catalog extension rows, threaded
  // into catalog, search, quick_order, and comparisons.
  const catalogAttributeReadService = new CatalogAttributeReadService(
    em,
    customFields.handle.definitionService,
  );

  // US7 — API keys, webhooks, external integrations. The handle exposes
  // requireApiKey, threaded into the catalog module's by-sku route so that
  // surface gets real bearer-token gating.
  const integrations = integrationsModule({
    emFactory: em,
    auditLogService,
    requireAdmin: requireTestAdmin(permissionService),
  });

  // Analytics (Phase 10 / T237). No GA4 forwarder in tests — the env vars
  // are unset by default so `buildForwarderFromEnv` returns a NoopForwarder.
  const analytics = analyticsModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
  });

  // Import/Export (Phase 10 / T240).
  const importExport = importExportModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
  });

  // SEO meta + sitemap (Phase 10 / T235). Stale-window dropped to zero in
  // tests so each test that calls regenerate sees a fresh payload.
  const seo = seoModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    auditLog: auditLogService,
    sitemap: { staleAfterMs: 0, baseUrl: 'http://test.local' },
  });

  // Languages + currencies (Phase 10 / T238). Static config, bootstrapped
  // by migration 012 with en-US + pl-PL languages and PLN + EUR currencies.
  const i18n = i18nModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    auditLog: auditLogService,
  });

  const dictionaries = dictionariesModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    redis,
    auditLog: auditLogService,
  });

  // Feature 005 — sales-channels module is built BEFORE every other module
  // that consumes its membership service in their composition (catalog,
  // cms, taxes, promotions, commerce for payment + delivery methods).
  const salesChannels = salesChannelsModule({
    emFactory: em,
    eventBus,
    redis,
    auditLogService,
    requireAdmin: requireTestAdmin(permissionService),
    dictionaryValidator: dictionaries.handle.validator,
    resolveAdminAuditContext: (request) => ({
      actorAdminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
  });

  // Feature 014 — CMS module. Reconcile seeded Hooks once; the storefront
  // resolver wraps Redis as a read-through cache.
  const cms = cmsModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    redis,
  });
  await cms.handle.reconcile();
  // Tests rely on writes being immediately visible. Wipe the namespace
  // before each backend boot so a previous run's keys don't bleed in.
  if (cms.handle.cache) await cms.handle.cache.invalidateAll();

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
  });

  // Taxes (T128 / FR-051) + Promotions (T129 / FR-052).
  const taxes = taxesModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    salesChannelMembership: salesChannels.handle.membershipService,
    dictionaryValidator: dictionaries.handle.validator,
    auditLog: auditLogService,
  });
  const promotions = promotionsModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    auditLog: auditLogService,
    salesChannelMembership: salesChannels.handle.membershipService,
    // Feature 012 / US8 — wire the catalog read port so the rule-target
    // picker + criterion validation work in tests.
    catalogQueryService: new CatalogQueryService(em, undefined, undefined, catalogAttributeReadService),
    dictionaryValidator: dictionaries.handle.validator,
    // Feature 026 US5 — org-targeted promotions skip when the Organization
    // is not active. Inlined as a raw SQL lookup to avoid coupling promotions
    // to the Organization entity at module-construction time.
    resolveOrganizationStatus: async (orgId) => {
      const row = (await em().getKnex()
        .raw(`select "status" from "organizations" where "id" = ? and "deleted_at" is null`, [orgId])) as { rows: Array<{ status: string }> };
      return row.rows[0]?.status ?? null;
    },
    // Feature 045 (T033) — Rule Builder picker sources (raw at the wiring layer).
    ruleTargets: {
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

  // Feature 047 — late-bound transactional-email sender (mirrors composition).
  let transactionalEmailSender: import('@b2b/contracts').TransactionalEmailSender | undefined;

  // Feature 062 — read-only inventory accessors backing the external catalog
  // namespace's availability indication (mirrors composition.ts).
  const externalAvailabilityStockLevels = new StockLevelService(em);
  const externalAvailabilityWarehouseChannels = new WarehouseChannelService(em);

  const modules: ModulePlugin[] = [
    async (app) => {
      registerTestAuth(app, {
        sessionService,
        emFactory: em,
        // Feature 062 — mirror production: Bearer sk_live_* resolves to an
        // api_key actor (incl. distributor binding) before the tenant hook
        // and the sales-channel resolver run.
        apiKeyResolver: async (token) => integrations.handle.apiKeyService.authenticate(token),
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
      app.addHook('onRequest', (request: FastifyRequest, _reply, done) => {
        buildContext(request).then(
          (ctx) => runInTenantContext(ctx, () => done()),
          (err: unknown) => done(err as Error),
        );
      });
    },
    admin.plugin,
    creditLimits.plugin,
    customFields.plugin,
    integrations.plugin,
    analytics.plugin,
    importExport.plugin,
    seo.plugin,
    i18n.plugin,
    cms.plugin,
    priceLists.plugin,
    taxes.plugin,
    promotions.plugin,
    commerceModule({
      commandBus,
      emFactory: em,
      eventBus,
      auditLogService,
      customFieldValues: customFields.handle.valueService,
      getTransactionalEmailSender: () => transactionalEmailSender,
      creditLimit: creditLimits.handle.creditLimitService,
      requireCustomer: requireTestCustomer(),
      requireAdmin: requireTestAdmin(permissionService),
      resolveCustomerContext: customerResolver,
      salesChannelMembership: salesChannels.handle.membershipService,
      // Real per-product VAT — mirrors composition.ts so placeOrder resolves the
      // rate from the tax rules instead of a flat 23%.
      resolveTaxRate: async ({ country, productType, vatStatus }) => {
        try {
          const resolved = await taxes.handle.taxService.taxRateFor({
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
      promotionService: promotions.handle.promotionService,
      redis,
      // Feature 062 — external orders namespace (mirrors composition.ts):
      // bound-key gate + the org method allow-lists (FR-021 envelope).
      requireBoundApiKey: integrations.handle.requireBoundApiKey,
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
      const moderationMailer = options.organizationsMailer ?? new ConsoleMailer();
      const adminNotifications = adminNotificationsModule({
        emFactory: em,
        requireAdmin: requireTestAdmin(permissionService),
      });
      const moderationService = new OrganizationModerationService(
        em,
        auditLogService,
        eventBus as unknown as OrganizationEventBus,
        moderationMailer,
        async () => 'manual',
      );
      const resolveScopeSalesChannelId = async (): Promise<string | null> =>
        (await salesChannels.handle.resolver.getSystemDefault())?.id ?? null;
      const resolveSalesChannelLanguage = async (salesChannelId: string): Promise<string> =>
        (await em().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage ?? 'en-US';
      const orgRegistrationNotifier = new OrgRegistrationNotifier({
        emFactory: em,
        adminNotificationService: adminNotifications.handle.adminNotificationService,
        mailer: moderationMailer,
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
        adminNotificationService: adminNotifications.handle.adminNotificationService,
        organizationContextService: new OrganizationContextService(em),
        restrictionService,
      };
      return [
        adminNotifications.plugin,
        organizationsModule({
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
          customFieldValues: customFields.handle.valueService,
          exposeTestProbe: true,
          dictionaryValidator: dictionaries.handle.validator,
          mailer: moderationMailer,
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
      customFieldValues: customFields.handle.valueService,
      customFieldDefinitions: customFields.handle.definitionService,
      // Feature 061 — apply seam + composed attribute read model.
      customFieldsPort: customFields.handle.definitionService,
      attributeReadService: catalogAttributeReadService,
      requireApiKey: integrations.handle.requireApiKey,
      // Feature 062 — external catalog namespace (mirrors composition.ts):
      // bound-key gate + the SAME pricing engine cart pricing uses + the
      // inventory availability port.
      requireBoundApiKey: integrations.handle.requireBoundApiKey,
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
      languageService: i18n.handle.languageService,
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
      dictionaryValidator: dictionaries.handle.validator,
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
    dictionaryValidator: dictionaries.handle.validator,
    resolveAdminAuditContext: (request) => ({
      actorAdminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
  });
  // Feature 042 — MFA module (mirrors composition.ts). Built after `settings`
  // so it can read MFA settings; its login port is bound to the late-bound
  // `testMfaLoginPort` captured by the auth services above.
  const mfa = mfaModule({
    emFactory: em,
    redis,
    settingsService: settings.handle.settingsService,
    auditLogService,
    sessionService,
    resolveDefaultChannelId: async () =>
      (await salesChannels.handle.resolver.getSystemDefault())?.id ?? null,
    secretEncryptionKey: process.env['MFA_SECRET_ENCRYPTION_KEY'],
    requireCustomer: requireTestCustomer(),
    requireAdmin: requireTestAdmin(permissionService),
    resolveCustomerActor: (request) => {
      if (request.testActor?.kind !== 'customer') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
      }
      return {
        customerAccountId: request.testActor.customerAccountId,
        organizationId: request.testActor.organizationId ?? null,
      };
    },
    resolveAdminActor: (request) => {
      if (request.testActor?.kind !== 'admin') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
      }
      return { adminUserId: request.testActor.adminUserId };
    },
    resolveOrganizationCustomerIds: async (organizationId) => {
      const rows = await em().find(CustomerAccount, { organizationId }, { fields: ['id'] });
      return rows.map((r) => r.id);
    },
    resolveOrgAdmin: async (request) => {
      if (request.testActor?.kind !== 'customer') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
      }
      const c = await em().findOne(CustomerAccount, { id: request.testActor.customerAccountId });
      if (!c || c.role !== 'organization_admin' || !c.organizationId) {
        throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Organization administrator role required.');
      }
      return { organizationId: c.organizationId, actor: c.id };
    },
    // Feature 042 US4/US5 — deterministic fake provider. `exchangeCode` derives
    // the identity from the `code` query so tests control the resolved email;
    // `unverified@example.com` simulates an unverified provider email.
    oauthProvider: fakeOAuthProvider,
    backendBaseUrl: 'http://localhost',
    storefrontBaseUrl: 'http://localhost:3000',
    adminBaseUrl: 'http://localhost:3002',
    socialAccountResolvers: {
      resolveCustomerByEmail: async (email) => {
        const c = await em().findOne(CustomerAccount, { email, deletedAt: null });
        return c ? { id: c.id } : null;
      },
      autoCreateCustomer: async (email) => {
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
      resolveAdminByEmail: async (email) => {
        const a = await em().findOne(AdminUser, { email, deletedAt: null, status: 'active' });
        return a ? { id: a.id } : null;
      },
    },
  });
  testMfaLoginPort = mfa.handle().mfaLoginPort;

  modules.push(salesChannels.plugin);
  modules.push(settings.plugin);
  modules.push(mfa.plugin);

  // Feature 019 — Admin UI i18n. Test wiring uses no lifecycle registry
  // (the boot-time bundle reconciler is skipped), so route-level tests
  // exercise only the HTTP surface and the in-process resolver. Tests
  // that need bundle rows seed the table directly via `h.em()`.
  const adminI18n = adminI18nModule({
    orm,
    emFactory: em,
    adminUserService: testAdminUserService,
    requireAdmin: requireTestAdmin(permissionService),
    resolveAdminContext: (request) => ({
      adminUserId:
        request.testActor?.kind === 'admin'
          ? request.testActor.adminUserId
          : TEST_ADMIN_ID,
    }),
  });
  modules.push(adminI18n.plugin);

  // Feature 020 — Admin Command Palette actions registry. Mounts the
  // GET /api/v1/admin/admin-actions read endpoint. Tests that need
  // module_actions rows seed them directly via `h.em()`.
  const adminActions = adminActionsModule({
    orm,
    emFactory: em,
    i18nService: adminI18n.handle.i18nService,
    permissionService,
    requireAdmin: requireTestAdmin(permissionService),
    resolveAdminContext: (request) => ({
      adminUserId:
        request.testActor?.kind === 'admin'
          ? request.testActor.adminUserId
          : TEST_ADMIN_ID,
    }),
  });
  modules.push(adminActions.plugin);

  // Feature 058 — Credentials module. Instantiated before the consumer modules
  // (prompt_actions, search, newsletter) so they can receive
  // `credentials.handle.service` for the `credential_ref` resolution path.
  if (!configurationTypeRegistry.isRegistered(llmConfigurationType.code)) {
    configurationTypeRegistry.register(llmConfigurationType);
  }
  if (!configurationTypeRegistry.isRegistered(emailAdapterConfigurationType.code)) {
    configurationTypeRegistry.register(emailAdapterConfigurationType);
  }
  const credentials = credentialsModule({
    emFactory: em,
    settings: settings.handle.settingsService,
    permissionService,
    requireAdmin: requireTestAdmin(permissionService),
    resolveAdminContext: (request) => ({
      adminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
    commandBus,
    configurationTypeRegistry,
    auditLogService,
    ...(process.env['SETTINGS_SECRET_ENCRYPTION_KEY']
      ? { secretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] }
      : {}),
  });
  modules.push(credentials.plugin);

  // Feature 043 — prompt assistant (mirrors composition.ts). Tool handlers
  // contributed by catalog/inventory; provider HTTP is injected by tests.
  const catalogToolDeps = {
    emFactory: em,
    events: eventBus,
    auditLogService,
    salesChannelMembership: salesChannels.handle.membershipService,
    redis,
  };
  const promptActions = promptActionsModule({
    emFactory: em,
    settings: settings.handle.settingsService,
    resolveSettingsChannelId: async () =>
      (await salesChannels.handle.resolver.getSystemDefault())?.id ?? 'default',
    permissionService,
    isModuleInstalled: (moduleId) => registryCache.isEnabled(moduleId),
    requireAdmin: requireTestAdmin(permissionService),
    resolveAdminContext: (request) => ({
      adminUserId:
        request.testActor?.kind === 'admin'
          ? request.testActor.adminUserId
          : TEST_ADMIN_ID,
    }),
    auditLogService,
    credentials: credentials.handle.service,
    bulkProgressResolver: catalogBulkProgressResolver(catalogToolDeps),
    ...(options.promptActionsLlmFetch !== undefined
      ? { llmFetch: options.promptActionsLlmFetch }
      : {}),
    ...(options.promptActionsNow !== undefined ? { now: options.promptActionsNow } : {}),
    ...(options.promptActionsTtlMinutes !== undefined
      ? { ttlMinutes: options.promptActionsTtlMinutes }
      : {}),
  });
  for (const tool of [
    ...catalogPromptResolverTools(catalogToolDeps),
    ...catalogPromptMutationTools(catalogToolDeps),
    ...inventoryPromptTools({ emFactory: em, eventBus, auditLogService }),
  ]) {
    promptActions.handle.registry.register(tool);
  }
  modules.push(promptActions.plugin);

  // Feature 013 — Assets Library. Routes mount under /api/v1/admin/assets/*
  // and /assets/file/:assetId.
  const assetsLibrary = assetsLibraryModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    auditLog: auditLogService,
  });
  modules.push(assetsLibrary.plugin);
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
  const megamenu = megamenuModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    redis,
    dictionaryValidator: dictionaries.handle.validator,
    validatorDeps: {
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
    },
    storefrontDeps: {
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
          content: { schema_version?: number; languages?: Record<string, unknown> };
        }>;
        const row = rows[0];
        if (!row) return null;
        const data = row.content.languages?.[language];
        if (data === undefined) return null;
        return {
          id: row.id,
          code: row.code,
          language,
          content: { schemaVersion: row.content.schema_version ?? 1, data },
        };
      },
    },
  });
  modules.push(megamenu.plugin);
  registerMegamenuCmsReferences(cms.handle.referenceRegistry, megamenu.handle.referenceRegistry);
  if (megamenu.handle.cache) await megamenu.handle.cache.invalidateAll();

  // Feature 016 — Blog module. Wires the cache + settings resolver +
  // asset-reference descriptors. Plugin runs the seed reconcilers
  // (Default Category + Blog Manager + Content Manager) on first
  // registration so contract tests start in a usable state.
  const blog = blogModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    redis,
    eventBus,
    settings: {
      get: (code, salesChannelId, schema) =>
        settings.handle.settingsService.get(code, salesChannelId, schema),
    },
    assetReferenceRegistry: assetsLibrary.handle.referenceRegistry,
    dictionaryValidator: dictionaries.handle.validator,
  });
  modules.push(blog.plugin);
  if (blog.handle.cache) await blog.handle.cache.invalidateAll();

  modules.push(dictionaries.plugin);
  if (dictionaries.handle.cache) await dictionaries.handle.cache.invalidateAll();

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
    credentials: credentials.handle.service,
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
  const comparisons = comparisonsModule({
    emFactory: em,
    catalogQueryService: new CatalogQueryService(em, undefined, undefined, catalogAttributeReadService),
    catalogAttributeRead: catalogAttributeReadService,
    settingsService: settings.handle.settingsService,
    requireAdmin: requireTestAdmin(permissionService),
  });
  modules.push(comparisons.plugin);
  // Late-bind the comparisons adoption hook used by the login flow above.
  comparisonAdoption = comparisons.handle.comparisonService.adoptAnonymousComparison.bind(
    comparisons.handle.comparisonService,
  );

  // Feature 008 — Quote Requests workflow.
  const quoteRequests = quoteRequestsModule({
    emFactory: em,
    eventBus,
    requireCustomer: requireTestCustomer(),
    requireAdmin: requireTestAdmin(permissionService),
    customFieldValues: customFields.handle.valueService,
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
        const resolved = await taxes.handle.taxService.taxRateFor({
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
    emFactory: em,
    sessionService,
    requireCustomer: requireTestCustomer(),
    commandBus,
    customFieldValues: customFields.handle.valueService,
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
    mailer: new ConsoleMailer(),
    storefrontBaseUrl: 'http://localhost:3000',
    resolveDeletionRetentionDays: async () => 365,
    resolvePresenceFreshnessMinutes: async () => 10,
    vatValidator: {
      provider: 'vies' as const,
      validate: async (input: { taxId: string; countryCode?: string | undefined }) => ({
        outcome:
          input.taxId === 'PL0000000099'
            ? ('validated' as const)
            : ('unverified' as const),
        legalName: input.taxId === 'PL0000000099' ? 'Test Organization' : null,
        address: null,
        errorKind: null,
      }),
    },
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
      creditTopup: new CreditTopupProvider(creditLimits.handle.creditLimitService),
      auditLog: auditLogService,
      notifier: new ReturnEmailNotifier(
        options.organizationsMailer ?? new ConsoleMailer(),
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
      mailer: options.organizationsMailer ?? new ConsoleMailer(),
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
      mailer: options.organizationsMailer ?? new ConsoleMailer(),
      auditLog: auditLogService,
      emitEvent: (name, payload) =>
        eventBus.emit(name, {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          ...payload,
        }),
      credentials: credentials.handle.service,
    }),
  );

  // Feature 049 — Google Analytics. No redis wired here, so /collect degrades
  // to 503 (queue producer absent); config + admin CRUD are fully exercised.
  modules.push(
    googleAnalyticsModule({
      emFactory: em,
      settings: settings.handle.settingsService,
      requireAdmin: requireTestAdmin(permissionService),
      channels: {
        idByCode: async (code) =>
          (await salesChannels.handle.resolver.getByCode(code))?.id ?? null,
        codeById: async (id) => {
          const { items } = await salesChannels.handle.salesChannelsService.list({});
          return items.find((c) => c.id === id)?.code ?? null;
        },
      },
      resolveAuditContext: (req) => ({
        actorAdminUserId: req.testActor?.kind === 'admin' ? req.testActor.adminUserId : null,
      }),
      auditLog: auditLogService,
    }),
  );

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

  // Feature 060 — API interceptor registry, mirroring composition.ts wiring.
  // Fixture registrations arrive via `options.configureInterceptors`; the
  // registry is sealed (after boot validation) inside app.ready().
  const apiInterceptors = new ApiInterceptorRegistry({
    isModuleEnabled: (moduleId) => registryCache.isEnabled(moduleId),
  });
  modules.push(async (app) => {
    registerApiInterceptorAdminRoutes(app, {
      registry: apiInterceptors,
      requireAdmin: requireTestAdmin(permissionService),
    });
  });
  options.configureInterceptors?.(apiInterceptors);

  // Feature 004 — boot-time manifest reconciliation. Runs before
  // app.ready() so contract tests start from a consistent settings
  // catalog.
  //   - settingsModuleManifest: built-in `general` group.
  //   - searchManifest:         feature-006 search group + 6 settings.
  await new ManifestReconciler(em()).apply([
    settingsModuleManifest,
    searchManifest,
    comparisonsManifest,
    quoteRequestsManifest,
    inventoryManifest,
    priceListsManifest,
    assetsLibraryManifest,
    blogManifest,
    mfaSettingsManifest,
    promptActionsSettingsManifest,
    pwaSettingsManifest,
    transactionalEmailsSettingsManifest,
    newsletterSettingsManifest,
    googleAnalyticsSettingsManifest,
    invoicesSettingsManifest,
    ksefSettingsManifest,
  ]);

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
        const translated = await adminI18n.handle.i18nService.translate(
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
  registryCache.__setEnabledForTesting(REGISTERED_MANIFESTS.map((e) => e.manifest.id));
  permissionCatalogueService.setEnabledModuleIdsAccessor(() => registryCache.enabledIds());
  await app.ready();

  return {
    app,
    orm,
    em,
    eventBus,
    apiInterceptors,
    redis,
    sessionService,
    auditLogService,
    promptActions: promptActions.handle,
    credentials: credentials.handle,
    invoices: invoices.handle,
    ksef: ksef.handle,
    pwa: pwa.handle,
    permissionService,
    permissionCatalogueService,
    settings: settings.handle,
    salesChannels: salesChannels.handle,
    integrations: integrations.handle,
    search: search.handle,
    comparisons: comparisons.handle,
    assetsLibrary: assetsLibrary.handle,
    cms: cms.handle,
    megamenu: megamenu.handle,
    blog: blog.handle,
    dictionaries: dictionaries.handle,
    adminI18n: adminI18n.handle,
    promotions: promotions.handle,
    customFields: customFields.handle,
    // Feature 061 — the composed attribute read model for test fixtures.
    catalogAttributeRead: catalogAttributeReadService,
    organizations: handleFeature026 ?? {
      moderationService: null as unknown as OrganizationModerationService,
      adminNotificationService: null as unknown as ReturnType<
        typeof adminNotificationsModule
      >['handle']['adminNotificationService'],
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
  h.redis.disconnect();
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
class FakeVatValidator implements VatValidator {
  constructor(public readonly provider: 'vies' | 'mf_pl') {}

  async validate(input: { taxId: string }): Promise<VatValidationResult> {
    const cleaned = input.taxId.replace(/[\s-]+/g, '').toUpperCase();
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
