import type { FastifyReply, FastifyRequest } from 'fastify';
import Redis from 'ioredis';
import { CustomerAccount } from './modules/customer_accounts/entities/customer-account.entity.js';
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
  const cmsPages = cmsPagesModule({ emFactory: em, requireAdmin });
  const priceLists = priceListsModule({ emFactory: em, requireAdmin });
  const taxes = taxesModule({ emFactory: em, requireAdmin });
  const promotions = promotionsModule({ emFactory: em, requireAdmin });

  let cartService: CartService | null = null;

  const organizationsSmtpUrl = resolveSmtpUrlFromEnv();
  const organizationsMailer = organizationsSmtpUrl
    ? new SmtpMailer(organizationsSmtpUrl)
    : new ConsoleMailer();

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
      },
    }),
    catalogModule({
      emFactory: em,
      eventBus,
      requireAdmin,
      auditLogService,
      requireApiKey: integrations.handle.requireApiKey,
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
    quoteRequestsModule({
      emFactory: em,
      eventBus,
      requireCustomer,
      requireAdmin,
      resolveCustomerContext: customerResolver,
      resolveAdminContext: adminContextResolver,
    }),
    inventoryModule({
      emFactory: em,
      requireCustomer,
      resolveCustomerContext: customerResolver,
      requireAdmin,
    }),
    shoppingListsModule({
      emFactory: em,
      eventBus,
      requireCustomer,
      resolveCustomerContext: customerResolver,
    }),
  ];

  // Feature 004 — Settings module. Routes (US2) live behind requireAdmin; the
  // universal getter (US3) is exposed via `settings.handle.settingsService`
  // for other modules to consume. The boot-time reconciler runs below before
  // HTTP comes up.
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
  modules.push(settings.plugin);

  // Feature 004 / T024 — Boot-time manifest reconciliation. Walks every
  // module's settings manifest and inserts any missing groups/settings
  // idempotently before the HTTP layer starts serving requests. NEVER deletes
  // (R-1); destructive uninstall is CLI-only.
  const settingsManifests: ModuleSettingsManifest[] = [
    settingsModuleManifest,
    // Other modules' manifests are appended here as they start using settings.
  ];
  const reconcilerEm = em();
  const reconciler = new ManifestReconciler(reconcilerEm);
  const reconciliation = await reconciler.apply(settingsManifests);
  for (const m of reconciliation.perModule) {
    if (m.orphanSettings.length > 0 || m.orphanGroups.length > 0) {
      // eslint-disable-next-line no-console -- boot-time logging path; logger
      // is wired further in (Fastify) and not yet available here.
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
