import type { FastifyReply, FastifyRequest } from 'fastify';
import Redis from 'ioredis';
import { CustomerAccount } from './modules/customer_accounts/entities/customer-account.entity.js';
import { AdminUser } from './modules/admin_users/entities/admin-user.entity.js';
import { AdminRole } from './modules/admin_roles/entities/admin-role.entity.js';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from './http/error-envelope.js';
import type { ModulePlugin } from './http/server.js';
import { initOrm, closeOrm } from './db/index.js';
import { EventBus } from './events/bus.js';
import { authPlugin } from './modules/auth/plugin.js';
import { SessionService } from './modules/auth/services/session-service.js';
import { AuditLogService } from './modules/audit_logs/services/audit-log-service.js';
import { PermissionService } from './modules/admin_roles/services/permission-service.js';
import { catalogModule } from './modules/catalog/plugin.js';
import { quoteRequestsModule } from './modules/quote_requests/plugin.js';
import { organizationsModule } from './modules/organizations/plugin.js';
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
import { cmsPagesModule } from './modules/cms_pages/plugin.js';
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
import { WarehouseChannelReconciler } from './modules/inventory/services/warehouse-channel-reconciler.js';
import { CatalogQueryService } from './modules/catalog/services/catalog-query.service.js';
import type { ModuleSettingsManifest } from '@b2b/contracts';
import type { CartService } from './modules/carts/services/cart-service.js';

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
  /** Closes the ORM + redis connection; call from a SIGTERM handler. */
  dispose: () => Promise<void>;
}

export async function composeApp(): Promise<ComposeAppHandle> {
  const orm = await initOrm();
  const em = (): EntityManager => orm.em.fork() as EntityManager;

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });

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
  const seo = seoModule({
    emFactory: em,
    requireAdmin,
    sitemap: {
      staleAfterMs: 60 * 60 * 1000,
      baseUrl: process.env['STOREFRONT_BASE_URL'] ?? 'http://localhost:3000',
    },
  });
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
  const salesChannels = salesChannelsModule({
    emFactory: em,
    eventBus,
    redis,
    auditLogService,
    requireAdmin,
    resolveAdminAuditContext: (request) => {
      if (request.actor.kind !== 'admin') return { actorAdminUserId: null };
      return { actorAdminUserId: request.actor.adminUserId };
    },
  });

  const cmsPages = cmsPagesModule({
    emFactory: em,
    requireAdmin,
    salesChannelMembership: salesChannels.handle.membershipService,
  });
  const priceLists = priceListsModule({ emFactory: em, requireAdmin });
  const taxes = taxesModule({
    emFactory: em,
    requireAdmin,
    salesChannelMembership: salesChannels.handle.membershipService,
  });
  const promotions = promotionsModule({
    emFactory: em,
    requireAdmin,
    salesChannelMembership: salesChannels.handle.membershipService,
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
    resolveAdminAuditContext: (request) => {
      if (request.actor.kind !== 'admin') return { actorAdminUserId: null };
      return { actorAdminUserId: request.actor.adminUserId };
    },
  });

  let cartService: CartService | null = null;

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

  const modules: ModulePlugin[] = [
    authModulePlugin,
    admin.plugin,
    creditLimits.plugin,
    integrations.plugin,
    analytics.plugin,
    importExport.plugin,
    seo.plugin,
    i18n.plugin,
    cmsPages.plugin,
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
    }),
  );

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
    dispose: async () => {
      redis.disconnect();
      await closeOrm();
    },
  };
}
