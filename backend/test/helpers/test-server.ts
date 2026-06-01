import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import Redis from 'ioredis';
import { buildServer, type ModulePlugin } from '../../src/http/server.js';
import { initOrm, closeOrm } from '../../src/db/index.js';
import { EventBus } from '../../src/events/bus.js';
import { SessionService } from '../../src/modules/auth/services/session-service.js';
import { AuditLogService } from '../../src/modules/audit_logs/services/audit-log-service.js';
import { PermissionService } from '../../src/modules/admin_roles/services/permission-service.js';
import { catalogModule } from '../../src/modules/catalog/plugin.js';
import { quoteRequestsModule } from '../../src/modules/quote_requests/plugin.js';
import { CustomerAccount } from '../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { AdminUser } from '../../src/modules/admin_users/entities/admin-user.entity.js';
import { AdminUserService } from '../../src/modules/admin_users/services/admin-user-service.js';
import { i18nModule as adminI18nModule } from '../../src/modules/_i18n/plugin.js';
import { adminActionsModule } from '../../src/modules/admin_actions/plugin.js';
import { AdminRole } from '../../src/modules/admin_roles/entities/admin-role.entity.js';
import { organizationsModule } from '../../src/modules/organizations/plugin.js';
import { adminNotificationsModule } from '../../src/modules/admin_notifications/plugin.js';
import { OrganizationModerationService } from '../../src/modules/organizations/services/organization-moderation-service.js';
import { OrganizationContextService } from '../../src/modules/organizations/services/organization-context-service.js';
import { OrganizationRestrictionService } from '../../src/modules/organizations/services/organization-restriction-service.js';
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
import { shoppingListsModule } from '../../src/modules/shopping_lists/plugin.js';
import { creditLimitsModule } from '../../src/modules/credit_limits/plugin.js';
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
import { salesChannelsModule } from '../../src/modules/sales_channels/plugin.js';
import { searchModule } from '../../src/modules/search/plugin.js';
import { searchManifest } from '../../src/modules/search/manifest.js';
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
}

export interface BackendServerHandle {
  app: FastifyInstance;
  orm: MikroORM;
  em: () => EntityManager;
  eventBus: EventBus;
  redis: Redis;
  sessionService: SessionService;
  auditLogService: AuditLogService;
  permissionService: PermissionService;
  /** Feature 004 — exposes the universal getter and cache invalidator for tests. */
  settings: ReturnType<typeof settingsModule>['handle'];
  /** Feature 005 — exposes the resolver, membership service, and CRUD service. */
  salesChannels: ReturnType<typeof salesChannelsModule>['handle'];
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

const SEEDED_TABLES = [
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
  const em = (): EntityManager => orm.em.fork() as EntityManager;

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  const sessionKeys = await redis.keys('session:*');
  if (sessionKeys.length > 0) await redis.del(sessionKeys);

  const sessionService = new SessionService(em, redis);
  const auditLogService = new AuditLogService(em);
  const permissionService = new PermissionService(em);

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

  // CartService is exposed by the commerce module so the login handler in
  // organizations can merge anonymous baskets after sign-in.
  let cartService: CartService | null = null;
  let shoppingListServiceRef: import('../../src/modules/shopping_lists/services/shopping-list-service.js').ShoppingListService | null = null;
  // Feature 039 — late-bound OrderService for the quick_order one-click flow.
  let orderServiceForOneClick: import('../../src/modules/orders/services/order-service.js').OrderService | null = null;
  let handleFeature026: BackendServerHandle['organizations'] | null = null;

  // Feature 026 US4 — restriction service + per-request allow-list resolvers.
  // Mirrors the composition.ts pattern: production wiring reads
  // `request.actor`; the test harness uses `request.testActor`.
  const sharedRestrictionService = new OrganizationRestrictionService(em);
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

  // Build the admin module first so we can hand its handle (auditLogService,
  // permissionService) to other modules that need it.
  const admin = adminModule({
    emFactory: em,
    sessionService,
    auditLogService,
    permissionService,
    requireAdmin: requireTestAdmin(permissionService),
    resolveAdminContext: (request) => ({
      adminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
  });

  // Credit-limits module — its CreditLimitService is the driver passed into
  // commerceModule below so OrderService.placeOrder can reserve atomically.
  const creditLimits = creditLimitsModule({
    emFactory: em,
    eventBus,
    requireCustomer: requireTestCustomer(),
    requireAdmin: requireTestAdmin(permissionService),
    resolveCustomerContext: customerResolver,
  });

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
    sitemap: { staleAfterMs: 0, baseUrl: 'http://test.local' },
  });

  // Languages + currencies (Phase 10 / T238). Static config, bootstrapped
  // by migration 012 with en-US + pl-PL languages and PLN + EUR currencies.
  const i18n = i18nModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
  });

  const dictionaries = dictionariesModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    redis,
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
  });
  const promotions = promotionsModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
    salesChannelMembership: salesChannels.handle.membershipService,
    // Feature 012 / US8 — wire the catalog read port so the rule-target
    // picker + criterion validation work in tests.
    catalogQueryService: new CatalogQueryService(em),
    dictionaryValidator: dictionaries.handle.validator,
    // Feature 026 US5 — org-targeted promotions skip when the Organization
    // is not active. Inlined as a raw SQL lookup to avoid coupling promotions
    // to the Organization entity at module-construction time.
    resolveOrganizationStatus: async (orgId) => {
      const row = (await em().getKnex()
        .raw(`select "status" from "organizations" where "id" = ? and "deleted_at" is null`, [orgId])) as { rows: Array<{ status: string }> };
      return row.rows[0]?.status ?? null;
    },
  });

  const modules: ModulePlugin[] = [
    async (app) => registerTestAuth(app, { sessionService, emFactory: em }),
    admin.plugin,
    creditLimits.plugin,
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
      emFactory: em,
      eventBus,
      auditLogService,
      creditLimit: creditLimits.handle.creditLimitService,
      requireCustomer: requireTestCustomer(),
      requireAdmin: requireTestAdmin(permissionService),
      resolveCustomerContext: customerResolver,
      salesChannelMembership: salesChannels.handle.membershipService,
      pricingService: priceLists.handle.pricingService,
      promotionService: promotions.handle.promotionService,
      redis,
      getRfqService: () => quoteRequests?.handle().rfqService ?? null,
      // Feature 039 — expose OrderService for the quick_order one-click flow.
      exposeOrderService: (svc) => {
        orderServiceForOneClick = svc;
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
      const orgRegistrationNotifier = new OrgRegistrationNotifier({
        emFactory: em,
        adminNotificationService: adminNotifications.handle.adminNotificationService,
        mailer: moderationMailer,
        resolveRecipients: async () => [],
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
          sessionService,
          requireCustomer: requireTestCustomer(),
          requireAdmin: requireTestAdmin(permissionService),
          resolveCustomerContext: customerResolver,
          auditLogService,
          moderationService,
          restrictionService,
          effectivePriceListsService,
          taxIdValidationService: testTaxIdValidationService,
          exposeTestProbe: true,
          dictionaryValidator: dictionaries.handle.validator,
          mailer: moderationMailer,
          storefrontBaseUrl: 'http://localhost:3000',
          onLogin: async (ctx) => {
            if (cartService && ctx.anonymousCartToken && ctx.organizationId) {
              const cartMerge = await cartService.mergeAnonymousIntoCustomer(
                ctx.anonymousCartToken,
                {
                  customerAccountId: ctx.customerAccountId,
                  organizationId: ctx.organizationId,
                },
              );
              return { cartMerge };
            }
            return {};
          },
        }),
      ];
    })(),
    catalogModule({
      emFactory: em,
      eventBus,
      requireAdmin: requireTestAdmin(permissionService),
      auditLogService,
      requireApiKey: integrations.handle.requireApiKey,
      salesChannelMembership: salesChannels.handle.membershipService,
      languageService: i18n.handle.languageService,
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
    dictionaryValidator: dictionaries.handle.validator,
    resolveAdminAuditContext: (request) => ({
      actorAdminUserId:
        request.testActor?.kind === 'admin' ? request.testActor.adminUserId : TEST_ADMIN_ID,
    }),
  });
  modules.push(salesChannels.plugin);
  modules.push(settings.plugin);

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

  // Feature 013 — Assets Library. Routes mount under /api/v1/admin/assets/*
  // and /assets/file/:assetId.
  const assetsLibrary = assetsLibraryModule({
    emFactory: em,
    requireAdmin: requireTestAdmin(permissionService),
  });
  modules.push(assetsLibrary.plugin);
  registerCatalogAssetReferences(assetsLibrary.handle.referenceRegistry, em);
  registerCmsAssetReferences(assetsLibrary.handle.referenceRegistry, em);
  registerMegamenuAssetReferences(assetsLibrary.handle.referenceRegistry, em);

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
    settingsService: settings.handle.settingsService,
    settingsAdminService: settings.handle.adminService,
    requireAdmin: requireTestAdmin(permissionService),
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
    catalogQueryService: new CatalogQueryService(em),
    settingsService: settings.handle.settingsService,
    requireAdmin: requireTestAdmin(permissionService),
  });
  modules.push(comparisons.plugin);

  // Feature 008 — Quote Requests workflow.
  const quoteRequests = quoteRequestsModule({
    emFactory: em,
    eventBus,
    requireCustomer: requireTestCustomer(),
    requireAdmin: requireTestAdmin(permissionService),
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
  });
  modules.push(quoteRequests.register);

  modules.push(
    shoppingListsModule({
      emFactory: em,
      rfqService: quoteRequests.handle().rfqService,
      requireCustomer: requireTestCustomer(),
      resolveCustomerContext: customerResolver,
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
  await app.ready();

  return {
    app,
    orm,
    em,
    eventBus,
    redis,
    sessionService,
    auditLogService,
    permissionService,
    settings: settings.handle,
    salesChannels: salesChannels.handle,
    search: search.handle,
    comparisons: comparisons.handle,
    assetsLibrary: assetsLibrary.handle,
    cms: cms.handle,
    megamenu: megamenu.handle,
    blog: blog.handle,
    dictionaries: dictionaries.handle,
    adminI18n: adminI18n.handle,
    promotions: promotions.handle,
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
