import type { FastifyReply, FastifyRequest } from 'fastify';
import Redis from 'ioredis';
import { CustomerAccount } from './modules/customer_accounts/entities/customer-account.entity.js';
import { AdminUser } from './modules/admin_users/entities/admin-user.entity.js';
import { AdminRole } from './modules/admin_roles/entities/admin-role.entity.js';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from './http/error-envelope.js';
import type { ModulePlugin } from './http/server.js';
import type { ErrorEnvelopeOptions } from './http/error-envelope.js';
import { initOrm, closeOrm } from './db/index.js';
import { EventBus } from './events/bus.js';
import { authPlugin } from './modules/auth/plugin.js';
import { SessionService } from './modules/auth/services/session-service.js';
import { AuditLogService } from './modules/audit_logs/services/audit-log-service.js';
import { PermissionService } from './modules/admin_roles/services/permission-service.js';
import { catalogModule } from './modules/catalog/plugin.js';
import { quoteRequestsModule } from './modules/quote_requests/plugin.js';
import { organizationsModule } from './modules/organizations/plugin.js';
import { adminNotificationsModule } from './modules/admin_notifications/plugin.js';
import { OrganizationModerationService } from './modules/organizations/services/organization-moderation-service.js';
import { OrganizationRestrictionService } from './modules/organizations/services/organization-restriction-service.js';
import { OrganizationEffectivePriceListsService } from './modules/organizations/services/organization-effective-pricelists-service.js';
import { OrganizationTaxIdValidationService } from './modules/organizations/services/organization-tax-id-validation-service.js';
import { ViesClient } from './modules/organizations/integrations/vies-client.js';
import { MinisterstwoFinansowClient } from './modules/organizations/integrations/ministerstwo-finansow-client.js';
import type { OrganizationEventBus } from './modules/organizations/services/registration-service.js';
import { OrgRegistrationNotifier } from './modules/organizations/services/org-registration-notifier.js';
import { OrganizationContextService } from './modules/organizations/services/organization-context-service.js';
import {
  moderationModeSchema,
  notificationRecipientsSchema,
} from './modules/organizations/schemas/settings.js';
import { ORGANIZATIONS_SETTING_CODES } from './modules/organizations/manifest.js';
import { ConsoleMailer } from './modules/email/services/mailer.js';
import { resolveSmtpUrlFromEnv } from './modules/email/resolve-smtp-url.js';
import { SmtpMailer } from './modules/email/services/smtp-mailer.js';
import { commerceModule } from './modules/orders/plugin.js';
import { adminModule } from './modules/admin_users/plugin.js';
import { inventoryModule } from './modules/inventory/plugin.js';
import { shoppingListsModule } from './modules/shopping_lists/plugin.js';
import { creditLimitsModule } from './modules/credit_limits/plugin.js';
import { integrationsModule } from './modules/api_keys/plugin.js';
import { analyticsModule } from './modules/analytics/plugin.js';
import { importExportModule } from './modules/import_export/plugin.js';
import { seoModule } from './modules/seo/plugin.js';
import { i18nModule } from './modules/languages/plugin.js';
import { cmsModule } from './modules/cms/plugin.js';
import { megamenuModule } from './modules/megamenu/plugin.js';
import { registerMegamenuAssetReferences } from './modules/megamenu/services/asset-references.js';
import { registerMegamenuCmsReferences } from './modules/megamenu/services/cms-references.js';
import { blogModule } from './modules/blog/plugin.js';
import { dictionariesModule } from './modules/dictionaries/plugin.js';
import { blogManifest } from './modules/blog/manifest.js';
import { priceListsModule } from './modules/price_lists/plugin.js';
import { taxesModule } from './modules/taxes/plugin.js';
import { promotionsModule } from './modules/promotions/plugin.js';
import { settingsModule } from './modules/settings/plugin.js';
import { settingsManifest as settingsModuleManifest } from './modules/settings/manifest.js';
import { ManifestReconciler } from './modules/settings/services/manifest-reconciler.js';
import { salesChannelsModule } from './modules/sales_channels/plugin.js';
import { salesChannelsManifest } from './modules/sales_channels/manifest.js';
import { DefaultChannelReconciler } from './modules/sales_channels/services/default-channel-reconciler.js';
import { searchModule } from './modules/search/plugin.js';
import { searchManifest } from './modules/search/manifest.js';
import { comparisonsModule } from './modules/comparisons/plugin.js';
import { comparisonsManifest } from './modules/comparisons/manifest.js';
import { quoteRequestsManifest, QUOTE_REQUESTS_SETTING_CODES } from './modules/quote_requests/manifest.js';
import { inventoryManifest } from './modules/inventory/manifest.js';
import { priceListsManifest } from './modules/price_lists/manifest.js';
import { assetsLibraryManifest } from './modules/assets_library/manifest.js';
import { assetsLibraryModule } from './modules/assets_library/plugin.js';
import { lifecycleModuleFromStaticEntries } from './modules/_lifecycle/plugin.js';
import { REGISTERED_MANIFESTS } from './modules/_lifecycle/registered-manifests.js';
import { i18nModule as adminI18nModule } from './modules/_i18n/plugin.js';
import { adminActionsModule } from './modules/admin_actions/plugin.js';
import { AdminUserService } from './modules/admin_users/services/admin-user-service.js';
import { registerCatalogAssetReferences } from './modules/catalog/services/asset-references.js';
import { registerCmsAssetReferences } from './modules/cms/services/asset-references.js';
import { WarehouseChannelReconciler } from './modules/inventory/services/warehouse-channel-reconciler.js';
import { CatalogQueryService } from './modules/catalog/services/catalog-query.service.js';
import type { ModuleSettingsManifest } from '@b2b/contracts';
import type { CartService } from './modules/carts/services/cart-service.js';
import type { ShoppingListService } from './modules/shopping_lists/services/shopping-list-service.js';

/**
 * Production composition root.
 *
 * Wires every business module against:
 *   - the real auth plugin (cookie / Bearer token → `request.actor`)
 *   - a permission-checked `requireAdmin` that consults `PermissionService`
 *   - resolvers that read from `request.actor` instead of the test-only
 *     `request.testActor` shim used by `test/helpers/test-server.ts`
 *
 * The dev script (`pnpm --filter backend run dev`) and the prod entry
 * (`backend/src/index.ts`) both call `composeApp({ app })` after
 * `buildServer({ ... modules: [] })`.
 */

export interface ComposeAppHandle {
  orm: MikroORM;
  redis: Redis;
  modules: ModulePlugin[];
  errorEnvelope: ErrorEnvelopeOptions;
  /** Closes the ORM + redis connection; call from a SIGTERM handler. */
  dispose: () => Promise<void>;
}

export async function composeApp(): Promise<ComposeAppHandle> {
  const orm = await initOrm();
  const em = (): EntityManager => orm.em.fork() as EntityManager;

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  // Feature 018 — separate ioredis client for the module-state pub/sub
  // channel. ioredis multiplexes commands and subscriptions on different
  // sockets, so we keep them on different clients to avoid the "subscribed
  // mode" command restriction on the main client.
  const redisSubscriber = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });

  const sessionService = new SessionService(em, redis);
  const auditLogService = new AuditLogService(em);
  const permissionService = new PermissionService(em);

  const eventBus = new EventBus();

  // ---- Cross-cutting actor resolvers --------------------------------------

  const requireCustomer = async (request: FastifyRequest): Promise<void> => {
    if (request.actor.kind !== 'customer') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
    }
  };

  const requireAdmin =
    (permission?: string) =>
    async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      if (request.actor.kind !== 'admin') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
      }
      if (!permission) return;
      const ok = await permissionService.hasPermission(request.actor.adminUserId, permission);
      if (!ok) {
        throw new HttpError(
          403,
          ERROR_CODES.FORBIDDEN,
          `Missing permission: ${permission}.`,
        );
      }
    };

  /**
   * Resolver for routes that require an authenticated Customer **with** an
   * Organization. Feature 026 US2 introduces no-org Customer accounts;
   * routes that read price lists, credit limit, addresses, or place orders
   * still need an Organization, so this resolver throws 422 when one is
   * missing. Routes that genuinely work without an Organization (cart-add,
   * browsing, profile-read) use `resolveCartActor` or read `request.actor`
   * directly.
   */
  const customerResolver = (
    request: FastifyRequest,
  ): {
    customerAccountId: string;
    organizationId: string;
    impersonatorAdminUserId?: string | null;
  } => {
    if (request.actor.kind !== 'customer') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
    }
    if (!request.actor.organizationId) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'This action requires an Organization attached to your account.',
        { code: 'organization_required' },
      );
    }
    return {
      customerAccountId: request.actor.customerAccountId,
      organizationId: request.actor.organizationId,
      impersonatorAdminUserId: request.actor.impersonatorAdminUserId ?? null,
    };
  };

  const adminContextResolver = (request: FastifyRequest): { adminUserId: string } => {
    if (request.actor.kind !== 'admin') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
    }
    return { adminUserId: request.actor.adminUserId };
  };

  // ---- Module composition (order mirrors test/helpers/test-server.ts) -----

  // Build the integrations module first so its API-key authenticator can be
  // injected into the auth plugin; that lets every Bearer-tokened request
  // resolve to an `actor.kind === 'api_key'` early in the request lifecycle.
  const integrations = integrationsModule({
    emFactory: em,
    auditLogService,
    requireAdmin,
  });

  const authModulePlugin: ModulePlugin = async (app) => {
    await app.register(authPlugin, {
      sessionService,
      apiKeyResolver: async (token) => integrations.handle.apiKeyService.authenticate(token),
      customerOrgResolver: async (customerAccountId) => {
        const customer = await em().findOne(CustomerAccount, { id: customerAccountId });
        return customer?.organizationId ?? null;
      },
    });
  };

  const admin = adminModule({
    emFactory: em,
    sessionService,
    auditLogService,
    permissionService,
    requireAdmin,
    resolveAdminContext: adminContextResolver,
  });

  const creditLimits = creditLimitsModule({
    emFactory: em,
    eventBus,
    requireCustomer,
    requireAdmin,
    resolveCustomerContext: customerResolver,
  });

  const analytics = analyticsModule({ emFactory: em, requireAdmin });
  const importExport = importExportModule({ emFactory: em, requireAdmin });
  // `seoModule` is instantiated AFTER settings (further below) so the
  // sitemap generator can read the per-channel `sales_channels.storefront_url`
  // setting via the SettingsService port. See `const seo = seoModule(...)` /
  // `modules.push(seo.plugin)` further down.
  const i18n = i18nModule({ emFactory: em, requireAdmin });

  // Feature 005 — Sales Channels module. The boot-time
  // DefaultChannelReconciler runs FIRST so every other module can rely on a
  // system-default channel existing; it must precede the modules array
  // because catalog (and later other modules) consume
  // `salesChannels.handle.membershipService` in their composition. The
  // plugin itself (resolver middleware) is pushed into `modules` below.
  const salesChannelsReconciler = new DefaultChannelReconciler(em, auditLogService);
  const salesChannelsReconciliation = await salesChannelsReconciler.run();
  if (salesChannelsReconciliation.action === 'warning' && salesChannelsReconciliation.warning) {
    console.warn(salesChannelsReconciliation.warning);
  }

  // Feature 010 — pair every active sales channel with a warehouse. Migration
  // 030 seeds the Default warehouse and tries to bind it to each channel, but
  // the seed runs BEFORE DefaultChannelReconciler creates the system channel
  // at boot. This reconciler catches up at runtime so US3 (channel→warehouse)
  // never sees a channel without at least one (default) assignment.
  await new WarehouseChannelReconciler(em()).run();

  // Feature 017 — construct the Dictionary module before its validator
  // consumers so the shared port can be threaded through their services.
  // The plugin itself is still registered later to preserve route order.
  const dictionaries = dictionariesModule({
    emFactory: em,
    requireAdmin,
    redis,
  });

  const salesChannels = salesChannelsModule({
    emFactory: em,
    eventBus,
    redis,
    auditLogService,
    requireAdmin,
    dictionaryValidator: dictionaries.handle.validator,
    resolveAdminAuditContext: (request) => {
      if (request.actor.kind !== 'admin') return { actorAdminUserId: null };
      return { actorAdminUserId: request.actor.adminUserId };
    },
  });

  // Feature 014 — CMS module (Pages, Blocks, Templates, Hooks, Page
  // Builder). Phase 2 ships module instantiation + seeded-Hook
  // reconciliation; admin/storefront routes land in subsequent phases.
  const cms = cmsModule({ emFactory: em, requireAdmin, redis });
  // Reconcile the 23 seeded Hook codes idempotently before HTTP starts.
  // The same logic also runs inside migration 035 so first boot has the
  // rows already; this call covers re-deploys when the seeded list grows.
  await cms.handle.reconcile();

  // The Megamenu module is constructed later in this composition root —
  // after the assetsLibrary module is built — so its `storefrontDeps`
  // can resolve asset URLs through the assets-library service. Search
  // for `megamenuModule(` below for the actual instantiation.
  const priceLists = priceListsModule({
    emFactory: em,
    requireAdmin,
    auditLogService,
    resolveAdminAuditContext: (request) => {
      const actor = (request as { actor?: { kind: 'admin'; adminUserId: string } }).actor;
      if (actor?.kind !== 'admin') {
        return { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
      }
      return { actorAdminUserId: actor.adminUserId };
    },
  });
  const taxes = taxesModule({
    emFactory: em,
    requireAdmin,
    salesChannelMembership: salesChannels.handle.membershipService,
    dictionaryValidator: dictionaries.handle.validator,
  });
  // Feature 012 / US8 — promotions reads catalog through CatalogQueryService
  // (the documented cross-module port — Constitution I) so the rule editor
  // can list `isPromoRule` attributes and the resolver can validate
  // `attribute` criteria against the authoritative option list.
  const catalogQueryServiceForPromotions = new CatalogQueryService(em);
  const promotions = promotionsModule({
    emFactory: em,
    requireAdmin,
    salesChannelMembership: salesChannels.handle.membershipService,
    catalogQueryService: catalogQueryServiceForPromotions,
    dictionaryValidator: dictionaries.handle.validator,
    // Feature 026 US5 — org-targeted promotions only fire for active Organizations.
    resolveOrganizationStatus: async (orgId) => {
      const row = (await em().getKnex()
        .raw(`select "status" from "organizations" where "id" = ? and "deleted_at" is null`, [orgId])) as { rows: Array<{ status: string }> };
      return row.rows[0]?.status ?? null;
    },
  });

  // Settings module is constructed up here (rather than further down) so its
  // SettingsService handle can be threaded into inventory + search at module
  // construction time. The plugin itself is still pushed onto `modules` below.
  const settings = settingsModule({
    emFactory: em,
    eventBus,
    auditLogService,
    requireAdmin,
    redis,
    dictionaryValidator: dictionaries.handle.validator,
    resolveAdminAuditContext: (request) => {
      if (request.actor.kind !== 'admin') return { actorAdminUserId: null };
      return { actorAdminUserId: request.actor.adminUserId };
    },
  });

  // SEO module — needs the SettingsService port for the per-channel
  // `sales_channels.storefront_url` setting that the sitemap generator
  // stamps into URLs. Plugin is pushed onto `modules` further below.
  const seo = seoModule({
    emFactory: em,
    requireAdmin,
    settings: {
      get: (code, salesChannelId, schema) =>
        settings.handle.settingsService.get(code, salesChannelId, schema),
    },
    sitemap: {
      staleAfterMs: 60 * 60 * 1000,
      baseUrl: process.env['STOREFRONT_BASE_URL'] ?? 'http://localhost:3000',
    },
  });

  let cartService: CartService | null = null;
  let shoppingListService: ShoppingListService | null = null;

  const organizationsSmtpUrl = resolveSmtpUrlFromEnv();
  const organizationsMailer = organizationsSmtpUrl
    ? new SmtpMailer(organizationsSmtpUrl)
    : new ConsoleMailer();

  // Forward-reference for the onLogin hook below — the comparisons module
  // is constructed further down (it depends on services declared after
  // this point), but the post-login hook needs to call into it. The
  // closure captures the binding, not its value, so the late assignment
  // is safe at request time.
  let comparisonAdoption: ((customerAccountId: string, anonymousToken: string) => Promise<void>) | null = null;

  // ── Feature 026 — Organizations moderation lifecycle ────────────────────
  //
  // Builds the admin_notifications sub-module + the moderation service +
  // the registration notifier, subscribes both to organization.registered.v1,
  // and exposes the resulting transaction gate (assertOrganizationCanTransact)
  // for the carts / orders / quote_requests modules.

  const adminNotifications = adminNotificationsModule({
    emFactory: em,
    requireAdmin,
  });

  const platformSettingsChannelId = process.env['ORGANIZATIONS_SETTINGS_CHANNEL_ID'] ?? 'default';

  const resolveModerationMode = async (): Promise<'auto' | 'manual'> => {
    try {
      return await settings.handle.settingsService.get(
        ORGANIZATIONS_SETTING_CODES.MODERATION_MODE,
        platformSettingsChannelId,
        moderationModeSchema,
      );
    } catch {
      // Setting not seeded / out-of-scope for the channel — degrade safely
      // to the most restrictive option so brand-new installs never grant
      // unverified Organizations transaction rights by accident.
      return 'manual';
    }
  };

  const resolveRegistrationRecipients = async (): Promise<string[]> => {
    try {
      return await settings.handle.settingsService.get(
        ORGANIZATIONS_SETTING_CODES.NEW_REGISTRATION_RECIPIENTS,
        platformSettingsChannelId,
        notificationRecipientsSchema,
      );
    } catch {
      return [];
    }
  };

  const organizationModerationService = new OrganizationModerationService(
    em,
    auditLogService,
    eventBus as unknown as OrganizationEventBus,
    organizationsMailer,
    resolveModerationMode,
  );

  const orgRegistrationNotifier = new OrgRegistrationNotifier({
    emFactory: em,
    adminNotificationService: adminNotifications.handle.adminNotificationService,
    mailer: organizationsMailer,
    resolveRecipients: resolveRegistrationRecipients,
  });

  const organizationContextService = new OrganizationContextService(em);
  const organizationRestrictionService = new OrganizationRestrictionService(em);

  /**
   * Feature 026 US6 — admin orders/RFQ visibility scope. Sales-rep admins
   * see only orders/RFQs from organizations they own; any other admin
   * (platform admin, content manager, etc.) sees everything.
   */
  const resolveAdminOrdersScope = async (
    request: FastifyRequest,
  ): Promise<{ allowAll: true } | { allowAll: false; allowedOrganizationIds: string[] }> => {
    const actor = (request as { actor?: { kind: string; adminUserId?: string } }).actor;
    if (!actor || actor.kind !== 'admin' || !actor.adminUserId) {
      return { allowAll: true };
    }
    const knex = em().getKnex();
    const roleRow = (await knex.raw(
      `select ar."code" as code from "admin_users" au left join "admin_roles" ar on ar."id" = au."admin_role_id" where au."id" = ?`,
      [actor.adminUserId],
    )) as { rows: Array<{ code: string | null }> };
    const roleCode = roleRow.rows[0]?.code ?? null;
    if (roleCode !== 'sales_representative') {
      return { allowAll: true };
    }
    const assignments = (await knex.raw(
      `select "organization_id" from "organization_sales_rep_assignments" where "admin_user_id" = ?`,
      [actor.adminUserId],
    )) as { rows: Array<{ organization_id: string }> };
    return {
      allowAll: false,
      allowedOrganizationIds: assignments.rows.map((r) => r.organization_id),
    };
  };

  /**
   * Builds per-request resolvers that fetch the caller's Organization
   * allow-list for one of the three restriction kinds. Anonymous requests
   * and no-org Customers return `null` (no filter applied; platform defaults).
   * Production wiring resolves the actor via `request.actor`; the test
   * harness uses `request.testActor` — both shapes are checked.
   */
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
      const lists = await organizationRestrictionService.readAllowLists(orgId);
      return lists[kind];
    } catch {
      // Org not found / soft-deleted — degrade to "no restriction".
      return null;
    }
  };

  const resolveOrganizationPaymentMethodAllowList = buildOrgAllowListResolver('paymentMethodIds');
  const resolveOrganizationDeliveryMethodAllowList = buildOrgAllowListResolver('deliveryMethodIds');
  const resolveOrganizationWarehouseAllowList = buildOrgAllowListResolver('warehouseIds');

  const organizationEffectivePriceListsService = new OrganizationEffectivePriceListsService({
    emFactory: em,
    resolveDefaultSalesChannelId: async () => {
      const channel = await salesChannels.handle.resolver.getSystemDefault();
      return channel?.id ?? 'default';
    },
  });

  // Feature 026 US7 — tax-ID validation. The two real clients hit VIES +
  // Ministerstwo Finansów. Both degrade safely on outage; the service
  // persists a record regardless of outcome and never throws upstream.
  const organizationTaxIdValidationService = new OrganizationTaxIdValidationService({
    emFactory: em,
    vies: new ViesClient(),
    mfPl: new MinisterstwoFinansowClient(),
  });
  const assertOrganizationCanTransact = async (organizationId: string): Promise<void> => {
    await organizationContextService.assertCanTransact(organizationId);
  };

  // Subscribe the two reactors to the registration event. Failures inside
  // either reactor never poison the registration itself — the EventBus
  // catches handler throws and logs them.
  eventBus.on('organization.registered.v1', async (payload) => {
    const orgId = (payload as unknown as { organizationId: string }).organizationId;
    await orgRegistrationNotifier.handleRegistered(orgId);
  });
  eventBus.on('organization.registered.v1', async (payload) => {
    const orgId = (payload as unknown as { organizationId: string }).organizationId;
    await organizationModerationService.handleNewlyRegistered(orgId);
  });

  const modules: ModulePlugin[] = [
    authModulePlugin,
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
      requireCustomer,
      requireAdmin,
      resolveCustomerContext: customerResolver,
      salesChannelMembership: salesChannels.handle.membershipService,
      pricingService: priceLists.handle.pricingService,
      promotionService: promotions.handle.promotionService,
      resolveCartActor: (request) => {
        if (request.actor.kind === 'customer') {
          return {
            customer: {
              customerAccountId: request.actor.customerAccountId,
              organizationId: request.actor.organizationId,
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
      assertOrganizationCanTransact,
      resolveOrganizationPaymentMethodAllowList,
      resolveOrganizationDeliveryMethodAllowList,
      resolveAdminOrdersScope,
      // Feature 027 — `Save to shopping list` bridge. Late-bound via
      // closure so the shopping_lists module (constructed below) can
      // inject the real service after this point.
      pushLineToShoppingList: async (input) => {
        if (!shoppingListService) {
          throw new Error('shopping_lists module not initialized');
        }
        await shoppingListService.addItem(
          {
            customerAccountId: input.customerAccountId,
            // ShoppingListService.addItem ignores organizationId for ownership
            // checks; we pass an empty string to satisfy the type.
            organizationId: '',
          },
          input.shoppingListId,
          {
            productId: input.productId,
            ...(input.variantId ? { variantId: input.variantId } : {}),
            quantity: input.quantity,
          },
        );
      },
    }),
    organizationsModule({
      emFactory: em,
      eventBus,
      sessionService,
      requireCustomer,
      requireAdmin,
      resolveCustomerContext: customerResolver,
      mailer: organizationsMailer,
      auditLogService,
      moderationService: organizationModerationService,
      restrictionService: organizationRestrictionService,
      effectivePriceListsService: organizationEffectivePriceListsService,
      taxIdValidationService: organizationTaxIdValidationService,
      dictionaryValidator: dictionaries.handle.validator,
      ...(process.env['STOREFRONT_BASE_URL']
        ? { storefrontBaseUrl: process.env['STOREFRONT_BASE_URL'] }
        : {}),
      onLogin: async (ctx) => {
        if (cartService && ctx.anonymousCartToken) {
          await cartService.mergeAnonymousIntoCustomer(ctx.anonymousCartToken, {
            customerAccountId: ctx.customerAccountId,
            organizationId: ctx.organizationId,
          });
        }
        // Comparisons module's anonymous→authenticated adoption (R-2 /
        // FR-005). The hook is late-bound below once `comparisons` is
        // constructed; before then it's a no-op.
        if (comparisonAdoption && ctx.anonymousCompareToken) {
          await comparisonAdoption(
            ctx.customerAccountId,
            ctx.anonymousCompareToken,
          );
        }
      },
    }),
    catalogModule({
      emFactory: em,
      eventBus,
      requireAdmin,
      auditLogService,
      requireApiKey: integrations.handle.requireApiKey,
      salesChannelMembership: salesChannels.handle.membershipService,
      languageService: i18n.handle.languageService,
      resolveAdminAuditContext: (request) => {
        if (request.actor.kind !== 'admin') {
          // Auditing an anonymous mutation shouldn't happen — the admin gate
          // refuses these — but if it ever does, fall back to a sentinel.
          return { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
        }
        return {
          actorAdminUserId: request.actor.adminUserId,
          impersonatedCustomerAccountId: null,
        };
      },
    }),
    inventoryModule({
      emFactory: em,
      requireCustomer,
      resolveCustomerContext: customerResolver,
      requireAdmin,
      eventBus,
      channelResolver: salesChannels.handle.resolver,
      settingsService: settings.handle.settingsService,
      dictionaryValidator: dictionaries.handle.validator,
      auditLogService,
      resolveAdminAuditContext: (request) => {
        const actor = (request as { actor?: { kind: 'admin'; adminUserId: string } }).actor;
        if (actor?.kind !== 'admin') {
          return { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
        }
        return { actorAdminUserId: actor.adminUserId };
      },
      resolveOrganizationWarehouseAllowList,
    }),
  ];

  // Feature 005 — Sales Channels plugin (resolver middleware on every
  // /api/v1/* request). The reconciler + module instantiation happen
  // earlier so other modules' compositions can consume the membership
  // service; here we only push the plugin into the routes array.
  modules.push(salesChannels.plugin);

  // Feature 004 — Settings module. The plugin is pushed here; the
  // service handle was constructed up at the inventory site so other
  // modules can read it at construction time. The boot-time reconciler
  // runs below before HTTP comes up.
  modules.push(settings.plugin);

  // Feature 013 — Assets Library. Phase 2 instantiates the module so its
  // manifest is reconciled and the AssetsLibraryService / referenceRegistry
  // are accessible to other modules. Routes (admin upload, public file
  // serving) and consumer wiring (Catalog / CMS reference descriptors) land
  // in subsequent phases (US1 + US2).
  const assetsLibrary = assetsLibraryModule({ emFactory: em, requireAdmin });
  modules.push(assetsLibrary.plugin);
  // Register Catalog's reference descriptors so the Library's soft-delete
  // path (FR-030) blocks deletion of any asset still pointed at by a
  // gallery item / product attachment / virtual-download / category main
  // image.
  registerCatalogAssetReferences(assetsLibrary.handle.referenceRegistry, em);
  registerCmsAssetReferences(assetsLibrary.handle.referenceRegistry, em);
  registerMegamenuAssetReferences(assetsLibrary.handle.referenceRegistry, em);

  // Feature 015 — Megamenu module. Wires the cross-module ports the
  // target validator + storefront resolver delegate to. v1 uses small
  // direct SQL lookups instead of forcing new upstream surfaces.
  const megamenu = megamenuModule({
    emFactory: em,
    requireAdmin,
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
  // Megamenu items that reference a CMS page or block block those entities'
  // deletion via the CMS module's reference registry.
  registerMegamenuCmsReferences(cms.handle.referenceRegistry, megamenu.handle.referenceRegistry);

  // Feature 016 — Blog module. Wires the cache + settings resolver +
  // asset-reference descriptors. Real admin/storefront routes land in
  // user-story phases (Phase 3+); the plugin currently runs the seed
  // reconcilers (Default Category + Blog Manager + Content Manager) on
  // first registration so the platform boots in a usable state.
  const blog = blogModule({
    emFactory: em,
    requireAdmin,
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

  // Feature 017 — Dictionary module. Boot reconciler populates the
  // ISO 3166-1 country catalogue, the major-currency seed metadata,
  // Polish translations for the active subset, and primary
  // language↔country associations. Idempotent — operator edits via
  // Admin UI / API are sticky across boots (FR-019). Admin + storefront
  // HTTP routes ship in user-story phases (Phase 3+); the plugin
  // currently performs the seed reconciler on first registration so
  // the platform boots with a fully populated registry.
  modules.push(dictionaries.plugin);

  // Feature 006 — Search module. Owns Meilisearch indexer + event-subscriber
  // lifecycle (R-3 — moved out of catalog). Settings-aware suggest config
  // resolution + LLM-toggle wrapper hook in via the same handle.
  const search = searchModule({
    emFactory: em,
    eventBus,
    settingsService: settings.handle.settingsService,
    settingsAdminService: settings.handle.adminService,
    requireAdmin,
    resolveAdminAuditContext: (request) => {
      if (request.actor.kind !== 'admin') return { actorAdminUserId: null };
      return { actorAdminUserId: request.actor.adminUserId };
    },
  });
  modules.push(search.plugin);

  // Feature 026 — Admin notifications bell. The plugin only mounts read
  // routes; writes happen via the handle (consumed above by the
  // OrgRegistrationNotifier and by future modules that emit notifications).
  modules.push(adminNotifications.plugin);

  // Feature 007 — Comparisons module. US1 wires the customer-facing CRUD
  // endpoints; US2/US4/US5 extend the plugin with share, PDF, and admin
  // routes respectively. Reads catalog through CatalogQueryService (the
  // documented service port — Constitution I) and `compare.max_products`
  // through SettingsService.
  const catalogQueryServiceForCompare = new CatalogQueryService(em);
  const comparisons = comparisonsModule({
    emFactory: em,
    catalogQueryService: catalogQueryServiceForCompare,
    settingsService: settings.handle.settingsService,
    requireAdmin,
  });
  modules.push(comparisons.plugin);
  // Late-bind the adoption hook captured by organizationsModule.onLogin
  // above; from this point onwards customer logins also adopt the
  // anonymous Comparison the caller was carrying (R-2 / spec FR-005).
  comparisonAdoption = comparisons.handle.comparisonService.adoptAnonymousComparison.bind(
    comparisons.handle.comparisonService,
  );

  // Feature 008 — Quote Requests workflow. Built after Settings so the
  // expiry worker can read `quote_requests.expiryDays` through the
  // settings service. Customer + admin context resolvers look up the
  // caller's role for visibility scoping (research §R2 / FR-011 / FR-013).
  const quoteRequests = quoteRequestsModule({
    emFactory: em,
    eventBus,
    requireCustomer,
    requireAdmin,
    resolveCustomerContext: async (request) => {
      if (request.actor.kind !== 'customer') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
      }
      if (!request.actor.organizationId) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'Quote Requests require an Organization attached to your account.',
          { code: 'organization_required' },
        );
      }
      const account = await em().findOne(CustomerAccount, {
        id: request.actor.customerAccountId,
      });
      return {
        customerAccountId: request.actor.customerAccountId,
        organizationId: request.actor.organizationId,
        isOrgAdmin: account?.role === 'organization_admin',
      };
    },
    resolveAdminContext: async (request) => {
      if (request.actor.kind !== 'admin') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
      }
      const adminUser = await em().findOne(AdminUser, { id: request.actor.adminUserId });
      const role = adminUser?.adminRoleId
        ? await em().findOne(AdminRole, { id: adminUser.adminRoleId })
        : null;
      return {
        adminUserId: request.actor.adminUserId,
        isPlatformAdmin: role?.code === 'platform_admin',
        roleLabel:
          role?.code === 'platform_admin'
            ? 'Platform administrator'
            : role?.code === 'sales_representative'
              ? 'Sales representative'
              : (role?.name ?? 'Administrator'),
      };
    },
    resolveExpiryDays: async () => {
      try {
        const { z } = await import('zod');
        const value = await settings.handle.settingsService.get(
          QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS,
          'default',
          z.number().int().nonnegative(),
        );
        return value;
      } catch {
        return 0;
      }
    },
    resolveBoolSetting: async (key) => {
      try {
        const { z } = await import('zod');
        const code =
          key === 'show_add_to_quote_on_card'
            ? QUOTE_REQUESTS_SETTING_CODES.SHOW_ADD_TO_QUOTE_ON_CARD
            : QUOTE_REQUESTS_SETTING_CODES.SHOW_ADD_TO_QUOTE_ON_PDP;
        return await settings.handle.settingsService.get(code, 'default', z.boolean());
      } catch {
        return true;
      }
    },
    assertOrganizationCanTransact,
  });
  modules.push(quoteRequests.register);

  // Shopping lists / quick order — depends on the RFQ service built above
  // so the "convert to RFQ" flow goes through the new createForCustomer API.
  modules.push(
    shoppingListsModule({
      emFactory: em,
      rfqService: quoteRequests.handle().rfqService,
      requireCustomer,
      resolveCustomerContext: customerResolver,
      // Feature 027 — late-bind the service for the carts module's
      // save-to-list bridge (commerceModule's pushLineToShoppingList).
      exposeShoppingListService: (svc) => {
        shoppingListService = svc;
      },
    }),
  );

  // Feature 018 — Module Lifecycle. Builds the static manifest registry
  // from every module's `manifest` export, exposes the orchestrator handle,
  // and starts the Redis-backed enabled-set cache (subscribes to the
  // `b2b:module:state-changed` pub/sub channel). The plugin pushed below
  // does the cache warming on first registration; the registry is built
  // here so other module compositions could consult it.
  // Feature 019 — Admin UI i18n. Built BEFORE the lifecycle so its
  // reconciler can be plugged into the orchestrator at construction
  // time. The boot-time bundle reconciler runs at plugin-attach via a
  // lazy registry accessor (the lifecycle's registry is populated by
  // the time the plugin chain is registered).
  let lifecycleRef: typeof lifecycle | undefined;
  const adminI18n = adminI18nModule({
    orm,
    emFactory: em,
    registry: () => lifecycleRef?.handle.registry,
    adminUserService: new AdminUserService(em),
    requireAdmin,
    resolveAdminContext: adminContextResolver,
  });

  // Feature 020 — Admin Command Palette actions registry. Built before
  // the lifecycle so its reconciler can be plugged into the orchestrator
  // at construction time.
  const adminActions = adminActionsModule({
    orm,
    emFactory: em,
    registry: () => lifecycleRef?.handle.registry,
    i18nService: adminI18n.handle.i18nService,
    permissionService,
    redisSubscriber,
    requireAdmin,
    resolveAdminContext: adminContextResolver,
  });

  const lifecycle = lifecycleModuleFromStaticEntries(
    {
      orm,
      redis,
      redisSubscriber,
      emFactory: em,
      auditLog: auditLogService,
      requireAdmin,
      // Feature 019: hand the i18n reconciler to the orchestrator so
      // module:install and module:uninstall --hard keep
      // translation_bundles aligned with the lifecycle.
      i18nReconciler: adminI18n.handle.reconciler,
      // Feature 020: hand the admin-actions reconciler to the
      // orchestrator so module:install and module:uninstall --hard keep
      // module_actions aligned with the lifecycle.
      adminActionsReconciler: adminActions.handle.reconciler,
    },
    REGISTERED_MANIFESTS.map((e) => ({
      manifest: e.manifest,
      filePath: e.filePath,
      ...(e.installHook ? { installHook: e.installHook } : {}),
      ...(e.uninstallHook ? { uninstallHook: e.uninstallHook } : {}),
    })),
  );
  lifecycleRef = lifecycle;

  modules.push(lifecycle.plugin);
  modules.push(adminI18n.plugin);
  modules.push(adminActions.plugin);

  // Feature 004 / T024 — Boot-time manifest reconciliation. Walks every
  // module's settings manifest and inserts any missing groups/settings
  // idempotently before the HTTP layer starts serving requests. NEVER deletes
  // (R-1); destructive uninstall is CLI-only.
  const settingsManifests: ModuleSettingsManifest[] = [
    settingsModuleManifest,
    salesChannelsManifest,
    searchManifest,
    comparisonsManifest,
    quoteRequestsManifest,
    inventoryManifest,
    priceListsManifest,
    assetsLibraryManifest,
    blogManifest,
    // Other modules' manifests are appended here as they start using settings.
  ];
  const reconcilerEm = em();
  const reconciler = new ManifestReconciler(reconcilerEm);
  const reconciliation = await reconciler.apply(settingsManifests);
  for (const m of reconciliation.perModule) {
    if (m.orphanSettings.length > 0 || m.orphanGroups.length > 0) {
      // Boot-time logging path; the Fastify logger is not yet available here.
      console.warn(
        `[settings] orphan rows for module "${m.moduleCode}": ` +
          `${m.orphanSettings.length} settings, ${m.orphanGroups.length} groups`,
      );
    }
    eventBus.emit('settings.module_reconciled', {
      eventId: `settings.module_reconciled:${m.moduleCode}:${Date.now()}`,
      occurredAt: new Date().toISOString(),
      moduleCode: m.moduleCode,
      addedCount: m.addedGroups + m.addedSettings,
      updatedCount: m.updatedGroups + m.updatedSettings,
      orphanCount: m.orphanGroups.length + m.orphanSettings.length,
    } as never);
  }

  return {
    orm,
    redis,
    modules,
    errorEnvelope: {
      resolvePreferredLanguage: async (request) => {
        if (request.actor.kind !== 'admin') return null;
        const adminUser = await em().findOne(AdminUser, { id: request.actor.adminUserId });
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
    dispose: async () => {
      redis.disconnect();
      redisSubscriber.disconnect();
      await closeOrm();
    },
  };
}
