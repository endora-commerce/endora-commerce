import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { z } from 'zod';
import { CustomerAccount } from './modules/customer_accounts/entities/customer-account.entity.js';
import { AdminUser } from './modules/admin_users/entities/admin-user.entity.js';
import { Organization } from './modules/organizations/entities/organization.entity.js';
import { AdminRole } from './modules/admin_roles/entities/admin-role.entity.js';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from './http/error-envelope.js';
import type { ModulePlugin } from './http/server.js';
import { registerHealthRoutes } from './modules/health_checks/routes.js';
import type { ErrorEnvelopeOptions } from './http/error-envelope.js';
import { initOrm, closeOrm } from './db/index.js';
import { EventBus } from './events/bus.js';
import { CommandBus } from './commands/index.js';
import fastifyPlugin from 'fastify-plugin';
import { forkScopedEm } from './tenancy/scoped-em.js';
import { runInTenantContext, type TenantContext } from './tenancy/tenant-context.js';
import { resolveTenantContext, systemTenantContext } from './tenancy/resolve-tenant-context.js';
import { withSystemScope } from './tenancy/escape-hatch.js';
import { authPlugin, promoteAdminActor } from './modules/auth/plugin.js';
import { SessionService } from './modules/auth/services/session-service.js';
import { AuditLogService } from './modules/audit_logs/services/audit-log-service.js';
import { PermissionService } from './modules/admin_roles/services/permission-service.js';
import { PermissionCatalogueService } from './modules/admin_roles/services/permission-catalogue.service.js';
import { AdminRoleService } from './modules/admin_roles/services/admin-role-service.js';
import { createRequireAdminAny } from './http/require-admin-any.js';
import {
  registryCache,
  STATE_CHANGED_CHANNEL,
} from './modules/_lifecycle/services/registry-cache.js';
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
// Feature 046 — Returns & Complaints (Refunds, RMA).
import { returnsModule } from './modules/returns/plugin.js';
import { stripeModule } from './modules/stripe/plugin.js';
import { OrderReturnContextProvider } from './modules/orders/services/order-return-context.js';
import { PaymentRefundProvider } from './modules/payments/services/payment-refund.js';
import { CorrectiveInvoiceProvider } from './modules/invoices/services/corrective-invoice.js';
import { invoicesModule } from './modules/invoices/plugin.js';
import { CreditTopupProvider } from './modules/credit_limits/services/credit-topup.js';
import { ReturnEmailNotifier } from './modules/returns/services/return-email-notifier.js';
import { AddressService } from './modules/addresses/services/address-service.js';
import type { OrderListService } from './modules/orders/services/order-list-service.js';
import type { OrderTransitionService } from './modules/orders/services/order-transition-service.js';
import { customersModule } from './modules/customers/plugin.js';
import { CUSTOMERS_SETTING_CODES } from './modules/customers/manifest.js';
import type { OrderService } from './modules/orders/services/order-service.js';
import { QUICK_ORDER_SETTING_CODES } from './modules/quick_order/manifest.js';
import { adminModule } from './modules/admin_users/plugin.js';
import { mfaModule } from './modules/mfa/plugin.js';
import type { MfaLoginPort } from './modules/auth/services/mfa-login-port.js';
import { verifyPassword, hashPassword } from './modules/auth/services/password-hasher.js';
import {
  OpenIdOAuthProvider,
  readOAuthConfigFromEnv,
  type OAuthProviderPort,
} from './modules/mfa/services/oauth-provider-service.js';
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
import { createSuggestionPricingEnricher } from './modules/search/services/suggestion-pricing-enricher.js';
import { SearchIndexer } from './modules/search/services/search-indexer.js';
import {
  searchManifest,
  SEARCH_SETTING_CODES,
  DEFAULT_REINDEX_INTERVAL_MINUTES,
} from './modules/search/manifest.js';
import { comparisonsModule } from './modules/comparisons/plugin.js';
import { comparisonsManifest } from './modules/comparisons/manifest.js';
import { quoteRequestsManifest, QUOTE_REQUESTS_SETTING_CODES } from './modules/quote_requests/manifest.js';
import { inventoryManifest } from './modules/inventory/manifest.js';
import { promptActionsModule } from './modules/prompt_actions/plugin.js';
import { promptActionsSettingsManifest } from './modules/prompt_actions/manifest.js';
// Feature 046 — Progressive Web App.
import { pwaModule } from './modules/pwa/plugin.js';
import { pwaSettingsManifest } from './modules/pwa/manifest.js';
// Feature 047 — Transactional Emails.
import { transactionalEmailsModule } from './modules/transactional_emails/plugin.js';
import { transactionalEmailsSettingsManifest } from './modules/transactional_emails/manifest.js';
// Feature 048 — Newsletter.
import { newsletterModule } from './modules/newsletter/plugin.js';
import { newsletterSettingsManifest } from './modules/newsletter/manifest.js';
// Feature 049 — Google Analytics.
import { googleAnalyticsModule } from './modules/google_analytics/plugin.js';
import { googleAnalyticsSettingsManifest } from './modules/google_analytics/manifest.js';
import { invoicesSettingsManifest } from './modules/invoices/manifest.js';
import { stripeSettingsManifest } from './modules/stripe/manifest.js';
import type { TransactionalEmailSender } from '@b2b/contracts';
import { emailDefaultsRegistry } from './modules/transactional_emails/services/email-defaults-registry.js';
import { ORDER_CONFIRMATION_DEFAULT } from './modules/orders/email-templates/order-confirmation.default.js';
import {
  ORDER_COMMENT_DEFAULT,
  REORDER_CREATED_DEFAULT,
  ADMIN_CREATED_ORDER_DEFAULT,
} from './modules/orders/email-templates/secondary-defaults.js';
import {
  RETURN_AUTHORIZED_DEFAULT,
  RETURN_REJECTED_DEFAULT,
} from './modules/returns/email-templates/transactional-defaults.js';
import {
  EMAIL_VERIFICATION_DEFAULT,
  ORGANIZATION_INVITATION_DEFAULT,
  NEW_ORG_REGISTRATION_DEFAULT,
} from './modules/organizations/email-templates/transactional-defaults.js';
import { makeOrgTemplateEmail } from './modules/organizations/services/org-template-email.js';
import {
  LOW_STOCK_ALERT_DEFAULT,
  AVAILABILITY_BACK_IN_STOCK_DEFAULT,
} from './modules/inventory/email-templates/transactional-defaults.js';
import { PAYMENT_STATUS_CHANGED_DEFAULT } from './modules/payments/email-templates/transactional-defaults.js';
import { SHIPMENT_CREATED_DEFAULT } from './modules/shipments/email-templates/transactional-defaults.js';
import { INVOICE_ISSUED_DEFAULT } from './modules/invoices/email-templates/invoice-issued.default.js';
import { PaymentEmailNotifier } from './modules/payments/services/payment-email-notifier.js';
import { ShipmentEmailNotifier } from './modules/shipments/services/shipment-email-notifier.js';
import { SalesChannel } from './modules/sales_channels/entities/sales-channel.entity.js';
import { Order } from './modules/orders/entities/order.entity.js';
import {
  catalogBulkProgressResolver,
  catalogPromptMutationTools,
  catalogPromptResolverTools,
} from './modules/catalog/prompt-tools.js';
import { inventoryPromptTools } from './modules/inventory/prompt-tools.js';
import { ordersPromptTools } from './modules/orders/prompt-tools.js';
import type { PromptActionTool } from './modules/prompt_actions/services/tool-registry.js';
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
  /** Feature 054 — the Command Bus, exposed so migrated module wiring can consume it. */
  commandBus: CommandBus;
  /** Closes the ORM + redis connection; call from a SIGTERM handler. */
  dispose: () => Promise<void>;
}

/** Pick a display label from a possibly-multilingual (jsonb) name value. */
function anyLabel(name: unknown): string {
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object') {
    const values = Object.values(name as Record<string, string>);
    return values[0] ?? '';
  }
  return '';
}

export async function composeApp(): Promise<ComposeAppHandle> {
  const orm = await initOrm();
  // Feature 050 — the single EM-injection seam. `forkScopedEm` stamps tenant
  // filter params from the ambient TenantContext on every fork. It is inert until
  // an entity is classified (@OrgScoped/@CustomerScoped attach the filters), so
  // this change is behaviorally neutral for unclassified entities.
  const em = (): EntityManager => forkScopedEm(orm);

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  // Principle X deployment dial. BACKEND_ROLE controls whether this process
  // runs queue consumers (workers):
  //   - unset / 'all'    → API + co-located workers (default single-VPS)
  //   - 'api'            → HTTP only; workers run in a separate `pnpm worker`
  //   - 'worker'         → workers only (set by src/worker.ts; no HTTP listen)
  const backendRole = process.env['BACKEND_ROLE'] ?? 'all';
  const runWorkers = backendRole !== 'api';
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
  const permissionCatalogueService = new PermissionCatalogueService({
    registryEntries: REGISTERED_MANIFESTS,
  });
  const adminRoleService = new AdminRoleService(em, permissionCatalogueService);

  const eventBus = new EventBus();

  // Feature 054 (Principle XIII) — the Command Bus: the single, guaranteed audit
  // writer for sensitive writes. It forks the scoped EM, runs the write + one
  // audit insert co-transactionally, and dispatches the domain event on commit.
  // Threaded into module factories alongside `eventBus` as writes are migrated.
  const commandBus = new CommandBus(orm, auditLogService, eventBus);

  // ---- Cross-cutting actor resolvers --------------------------------------

  const requireCustomer = async (request: FastifyRequest): Promise<void> => {
    if (request.actor.kind !== 'customer') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
    }
  };

  const requireAdmin =
    (permission?: string) =>
    async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
      promoteAdminActor(request);
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

  const requireAdminAny = createRequireAdminAny(permissionService);

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

  /**
   * Resolver for customer routes that work with or without an Organization
   * (e.g. Returns history/submission). Unlike `customerResolver`, it does not
   * require an Organization — it only asserts a customer session.
   */
  const resolveCustomerAccountId = (request: FastifyRequest): string => {
    if (request.actor.kind !== 'customer') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
    }
    return request.actor.customerAccountId;
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
      customerOrgResolver: async (customerAccountId) =>
        // Feature 050 — runs in the auth hook, before the tenant context exists;
        // identity resolution is a system-scoped read.
        withSystemScope('auth: resolve customer org', async () => {
          const customer = await em().findOne(CustomerAccount, { id: customerAccountId });
          return customer?.organizationId ?? null;
        }),
    });
  };

  // Feature 042 — the MFA module is constructed after `settings` exists, so its
  // login port is late-bound here and resolved lazily by the auth services.
  let mfaLoginPort: MfaLoginPort | undefined;
  const getMfaLoginPort = (): MfaLoginPort | undefined => mfaLoginPort;

  const admin = adminModule({
    emFactory: em,
    sessionService,
    auditLogService,
    permissionService,
    permissionCatalogueService,
    adminRoleService,
    requireAdmin,
    resolveAdminContext: adminContextResolver,
    getMfaLoginPort,
  });

  const creditLimits = creditLimitsModule({
    emFactory: em,
    eventBus,
    commandBus,
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
    commandBus,
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
    // Feature 045 (T033) — Rule Builder picker sources. Channels + customer
    // groups come from their module services; the rest are read at the wiring
    // layer so the promotions module stays decoupled (Principle I).
    ruleTargets: {
      salesChannels: async () => {
        const { items } = await salesChannels.handle.salesChannelsService.list({});
        return items.map((c) => ({ id: c.id, code: c.code, name: anyLabel(c.name) }));
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
        return res.rows.map((r) => ({ id: r.id, slug: r.slug, name: anyLabel(r.name), parentCategoryId: r.parent_category_id ?? null }));
      },
      paymentMethods: async () => {
        const res = (await em().getKnex().raw(
          `select "id", "code", "name" from "payment_methods" where "status" = 'active' order by "code" asc`,
        )) as { rows: Array<{ id: string; code: string; name: unknown }> };
        return res.rows.map((r) => ({ id: r.id, code: r.code, name: anyLabel(r.name) }));
      },
      deliveryMethods: async () => {
        const res = (await em().getKnex().raw(
          `select "id", "code", "name" from "delivery_methods" where "status" = 'active' order by "code" asc`,
        )) as { rows: Array<{ id: string; code: string; name: unknown }> };
        return res.rows.map((r) => ({ id: r.id, code: r.code, name: anyLabel(r.name) }));
      },
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
    ...(process.env['SETTINGS_SECRET_ENCRYPTION_KEY']
      ? { secretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] }
      : {}),
    dictionaryValidator: dictionaries.handle.validator,
    resolveAdminAuditContext: (request) => {
      if (request.actor.kind !== 'admin') return { actorAdminUserId: null };
      return { actorAdminUserId: request.actor.adminUserId };
    },
  });

  // Secret settings (e.g. prompt_actions API keys) are AES-256-GCM encrypted
  // at rest with SETTINGS_SECRET_ENCRYPTION_KEY. The key is read from the
  // environment once at boot — so a value added to `.env` only takes effect
  // after the backend is restarted (the dev watcher does not reload on `.env`
  // changes). Warn loudly here so a missing/unloaded key is obvious instead of
  // surfacing only as a 500 ("…is not configured…") when an operator tries to
  // save a secret.
  if (!process.env['SETTINGS_SECRET_ENCRYPTION_KEY']) {
    // Boot-time logging path; the Fastify logger is not yet available here.
    console.warn(
      '[settings] SETTINGS_SECRET_ENCRYPTION_KEY is not set — secret settings ' +
        '(e.g. prompt_actions API keys) cannot be saved. Set a base64 32-byte key ' +
        '(openssl rand -base64 32) in backend/.env (see .env.example) and restart the backend.',
    );
  }

  // Feature 042 — MFA module. Constructed here (after `settings`) so it can
  // read the per-scope MFA settings; its login port is bound to the late-bound
  // `mfaLoginPort` captured by the auth services above. Plugin pushed below.
  // Feature 042 US4/US5 — federated sign-in. Wire the OIDC provider only when
  // at least one provider is configured via env; otherwise the OAuth routes
  // are simply not registered.
  const oauthConfig = readOAuthConfigFromEnv();
  const oauthProvider: OAuthProviderPort | undefined =
    oauthConfig.google || oauthConfig.microsoft
      ? new OpenIdOAuthProvider(oauthConfig)
      : undefined;
  const mfaSocialResolvers = {
    resolveCustomerByEmail: async (email: string) =>
      // Feature 050 — social-login identity resolution, before tenant context.
      withSystemScope('mfa: resolve customer by email', async () => {
        const c = await em().findOne(CustomerAccount, { email, deletedAt: null });
        return c ? { id: c.id } : null;
      }),
    autoCreateCustomer: async (email: string) => {
      let allowed = false;
      try {
        const { z } = await import('zod');
        allowed = await settings.handle.settingsService.get(
          'customers.allow_registration_without_organization',
          'default',
          z.boolean(),
        );
      } catch {
        allowed = false;
      }
      if (!allowed) return null;
      const account = em().create(CustomerAccount, {
        email,
        passwordHash: await hashPassword(randomUUID() + randomUUID()),
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
  };

  const mfa = mfaModule({
    emFactory: em,
    redis,
    settingsService: settings.handle.settingsService,
    auditLogService,
    sessionService,
    resolveDefaultChannelId: async () =>
      (await salesChannels.handle.resolver.getSystemDefault())?.id ?? null,
    secretEncryptionKey: process.env['MFA_SECRET_ENCRYPTION_KEY'],
    ...(oauthProvider ? { oauthProvider } : {}),
    socialAccountResolvers: mfaSocialResolvers,
    ...(process.env['BACKEND_PUBLIC_URL'] ? { backendBaseUrl: process.env['BACKEND_PUBLIC_URL'] } : {}),
    ...(process.env['STOREFRONT_BASE_URL'] ? { storefrontBaseUrl: process.env['STOREFRONT_BASE_URL'] } : {}),
    ...(process.env['ADMIN_BASE_URL'] ? { adminBaseUrl: process.env['ADMIN_BASE_URL'] } : {}),
    requireCustomer,
    requireAdmin,
    resolveCustomerActor: (request) => {
      if (request.actor.kind !== 'customer') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
      }
      return {
        customerAccountId: request.actor.customerAccountId,
        organizationId: request.actor.organizationId ?? null,
      };
    },
    resolveAdminActor: (request) => {
      promoteAdminActor(request);
      if (request.actor.kind !== 'admin') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
      }
      return { adminUserId: request.actor.adminUserId };
    },
    resolveOrganizationCustomerIds: async (organizationId) => {
      const rows = await em().find(CustomerAccount, { organizationId }, { fields: ['id'] });
      return rows.map((r) => r.id);
    },
    resolveOrgAdmin: async (request) => {
      if (request.actor.kind !== 'customer') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
      }
      const c = await em().findOne(CustomerAccount, { id: request.actor.customerAccountId });
      if (!c || c.role !== 'organization_admin' || !c.organizationId) {
        throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Organization administrator role required.');
      }
      return { organizationId: c.organizationId, actor: c.id };
    },
    resolveAccountEmail: async (subjectType, subjectId) => {
      const em2 = em();
      if (subjectType === 'admin') {
        const a = await em2.findOne(AdminUser, { id: subjectId });
        return a?.email ?? null;
      }
      const c = await em2.findOne(CustomerAccount, { id: subjectId });
      return c?.email ?? null;
    },
    verifyAccountPassword: async (subjectType, subjectId, password) => {
      const em2 = em();
      if (subjectType === 'admin') {
        const a = await em2.findOne(AdminUser, { id: subjectId });
        return a ? verifyPassword(a.passwordHash, password) : false;
      }
      const c = await em2.findOne(CustomerAccount, { id: subjectId });
      return c ? verifyPassword(c.passwordHash, password) : false;
    },
  });
  mfaLoginPort = mfa.handle().mfaLoginPort;

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
  // Feature 039 — late-bound OrderService for the quick_order one-click flow.
  let orderServiceForOneClick: OrderService | null = null;
  // Feature 040 — late-bound OrderListService for the customers module's
  // self-service + admin order-history panels.
  let orderListServiceForCustomers: OrderListService | null = null;
  // Feature 043 — late-bound OrderTransitionService for the orders
  // prompt-action status tools.
  let orderTransitionServiceForPrompts: OrderTransitionService | null = null;

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

  // Feature 047 — org emails resolve against the system-default sales channel.
  const resolveScopeSalesChannelId = async (): Promise<string | null> =>
    (await em().findOne(SalesChannel, { systemDefault: true }))?.id ?? null;
  const resolveSalesChannelLanguage = async (salesChannelId: string): Promise<string> =>
    (await em().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage ?? 'en-US';
  const orgRegistrationNotifier = new OrgRegistrationNotifier({
    emFactory: em,
    adminNotificationService: adminNotifications.handle.adminNotificationService,
    mailer: organizationsMailer,
    resolveRecipients: resolveRegistrationRecipients,
    templateEmail: makeOrgTemplateEmail({
      getSender: () => transactionalEmailSender,
      resolveScopeSalesChannelId,
      resolveLanguage: resolveSalesChannelLanguage,
    }),
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

  // Liveness/readiness endpoint (`/api/v1/_health`). The health_checks module
  // ships the route factory but never wired it in — register it here with live
  // pings to Postgres/Redis/Meilisearch. Orchestrators (compose healthcheck)
  // depend on this returning 200; without it the route 404s and the backend
  // container is reported unhealthy forever.
  const healthPlugin: ModulePlugin = async (app) => {
    await registerHealthRoutes(app, {
      pingDatabase: async () => {
        await orm.em.getConnection().execute('select 1');
        return true;
      },
      pingRedis: async () => (await redis.ping()) === 'PONG',
      pingMeilisearch: async () => {
        const base = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
        const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
        return res.ok;
      },
    });
  };

  // Feature 047 — late-bound transactional-email sender. commerceModule (and
  // other owning modules) read it via a getter; the transactional_emails module
  // sets it through exposeSender once built.
  let transactionalEmailSender: TransactionalEmailSender | undefined;

  // Feature 050 — establish the ambient TenantContext for every request from the
  // already-authenticated actor (never from request inputs). fp-wrapped and
  // registered right after auth so its onRequest runs after `request.actor` is set
  // and applies globally (mirrors the auth plugin). See specs/050-org-tenant-scoping/.
  const tenantContextModulePlugin: ModulePlugin = async (app) => {
    await app.register(
      fastifyPlugin(async (inner) => {
        const buildContext = async (request: FastifyRequest): Promise<TenantContext> => {
          const actor = request.actor;
          if (actor.kind === 'customer') {
            const orgId =
              actor.organizationId && actor.organizationId.length > 0 ? actor.organizationId : null;
            return resolveTenantContext({
              kind: 'customer',
              customerAccountId: actor.customerAccountId,
              organizationId: orgId,
              impersonatorAdminUserId: actor.impersonatorAdminUserId,
            });
          }
          if (actor.kind === 'admin') {
            const scope = await resolveAdminOrdersScope(request);
            return resolveTenantContext({ kind: 'admin', adminUserId: actor.adminUserId }, scope);
          }
          // anonymous / api_key: trusted platform read scope. Guest-owned rows are
          // scoped by their own token mechanism, not by the tenant filter.
          return systemTenantContext(`actor:${actor.kind}`);
        };
        // Callback-style hook so the AsyncLocalStorage store propagates to the
        // route handler (async `enterWith` would not). See runInTenantContext.
        inner.addHook('onRequest', (request: FastifyRequest, _reply, done) => {
          buildContext(request).then(
            (ctx) => runInTenantContext(ctx, () => done()),
            (err: unknown) => done(err as Error),
          );
        });
      }),
    );
  };

  const modules: ModulePlugin[] = [
    healthPlugin,
    authModulePlugin,
    tenantContextModulePlugin,
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
      commandBus,
      emFactory: em,
      eventBus,
      auditLogService,
      mailer: organizationsMailer,
      // Feature 047 — late-bound; set once the transactional_emails module builds.
      getTransactionalEmailSender: () => transactionalEmailSender,
      creditLimit: creditLimits.handle.creditLimitService,
      requireCustomer,
      requireAdmin,
      resolveCustomerContext: customerResolver,
      salesChannelMembership: salesChannels.handle.membershipService,
      pricingService: priceLists.handle.pricingService,
      addressService: new AddressService(em, dictionaries.handle.validator),
      promotionService: promotions.handle.promotionService,
      redis,
      // Feature 027 US5 — abandonment-sweep resolvers + dispatcher.
      resolveCartAbandonmentInactivityMinutes: async () => {
        try {
          const { z } = await import('zod');
          return await settings.handle.settingsService.get(
            'carts.abandonment.inactivity_minutes',
            'default',
            z.number().int().nonnegative(),
          );
        } catch {
          return 0;
        }
      },
      resolveCartAbandonmentNotificationRecipient: async () => {
        try {
          const { z } = await import('zod');
          return await settings.handle.settingsService.get(
            'carts.abandonment.notification_recipient',
            'default',
            z.string(),
          );
        } catch {
          return '';
        }
      },
      // Feature 036 — business Order ID prefix/suffix, resolved per Sales
      // Channel. Missing/out-of-scope settings resolve to '' (bare numeric ID).
      resolveOrderBusinessIdPrefix: async (salesChannelId: string) => {
        try {
          const { z } = await import('zod');
          return await settings.handle.settingsService.get(
            'orders.business_id.prefix',
            salesChannelId,
            z.string(),
          );
        } catch {
          return '';
        }
      },
      resolveOrderBusinessIdSuffix: async (salesChannelId: string) => {
        try {
          const { z } = await import('zod');
          return await settings.handle.settingsService.get(
            'orders.business_id.suffix',
            salesChannelId,
            z.string(),
          );
        } catch {
          return '';
        }
      },
      // Feature 038 US6 — reorder enable flag, resolved per Sales Channel.
      // Missing/out-of-scope settings resolve to enabled (the default).
      resolveReorderEnabled: async (salesChannelId: string) => {
        try {
          const { z } = await import('zod');
          return await settings.handle.settingsService.get(
            'orders.reorder_enabled',
            salesChannelId,
            z.boolean(),
          );
        } catch {
          return true;
        }
      },
      // Feature 038 US4 — additional order-confirmation recipients per scope.
      resolveOrderConfirmationRecipients: async (salesChannelId: string) => {
        try {
          const { z } = await import('zod');
          return await settings.handle.settingsService.get(
            'orders.confirmation_recipients',
            salesChannelId,
            z.array(z.string()),
          );
        } catch {
          return [];
        }
      },
      // Feature 038 US3 / FR-035 — minimum order value per scope (0 = none).
      resolveMinOrderValue: async (salesChannelId: string) => {
        try {
          const { z } = await import('zod');
          return await settings.handle.settingsService.get(
            'orders.min_order_value',
            salesChannelId,
            z.number(),
          );
        } catch {
          return 0;
        }
      },
      // Real per-product VAT — resolve the rate from the product's tax class
      // (its `type`), the billing country, and the org VAT status, against the
      // `taxes` rules (mirrors Quote Requests). order-service already returns 0
      // for VAT-exempt / reverse-charge orgs; failures degrade to a flat 23%.
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
      // Sales-channel layer of the fulfilment-strategy precedence chain — the
      // SettingsService collapses per-channel value → global value → manifest
      // default ('default_first'). Failures degrade to that same default.
      resolveChannelFulfilmentStrategy: async (salesChannelId: string) => {
        try {
          const { z } = await import('zod');
          return await settings.handle.settingsService.get(
            'inventory.fulfilment_strategy',
            salesChannelId,
            z.enum([
              'any',
              'default_first',
              'lowest_stock_first',
              'highest_stock_first',
              'defined_order',
            ]),
          );
        } catch {
          return 'default_first';
        }
      },
      resolveChannelFulfilmentWarehouseOrder: async (salesChannelId: string) => {
        try {
          const { z } = await import('zod');
          return await settings.handle.settingsService.get(
            'inventory.fulfilment_strategy_warehouse_order',
            salesChannelId,
            z.array(z.string()),
          );
        } catch {
          return [];
        }
      },
      // Global backorder gate — collapses per-channel value → global value →
      // manifest default (false). Failures degrade to false (never oversell).
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
      getRfqService: () => quoteRequests?.handle().rfqService ?? null,
      // Feature 039 — expose OrderService for the quick_order one-click flow.
      exposeOrderService: (svc) => {
        orderServiceForOneClick = svc;
      },
      // Feature 040 — expose OrderListService for the customers module.
      exposeOrderListService: (svc) => {
        orderListServiceForCustomers = svc;
      },
      // Feature 043 — capture the configured transition engine for the orders
      // prompt-action tools (reuses its guards + cancel side-effects).
      exposeOrderTransitionService: (svc) => {
        orderTransitionServiceForPrompts = svc;
      },
      appendShoppingListToCart: async (input) => {
        if (!shoppingListService) {
          throw new Error('shopping_lists module not initialized');
        }
        const res = await shoppingListService.convertToCart(
          {
            customerAccountId: input.customerAccountId,
            organizationId: input.organizationId ?? '',
          },
          input.shoppingListId,
          undefined,
        );
        // Map ShoppingListService.convertToCart's shape onto the carts
        // module's uniform return shape across the three conversions.
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
    }),
    organizationsModule({
      emFactory: em,
      eventBus,
      sessionService,
      getMfaLoginPort,
      requireCustomer,
      requireAdmin,
      requireAdminAny,
      resolveCustomerContext: customerResolver,
      mailer: organizationsMailer,
      getTransactionalEmailSender: () => transactionalEmailSender,
      resolveScopeSalesChannelId,
      resolveSalesChannelLanguage,
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
        let cartMerge: Awaited<
          ReturnType<NonNullable<typeof cartService>['mergeAnonymousIntoCustomer']>
        > | undefined;
        if (cartService && ctx.anonymousCartToken) {
          cartMerge = await cartService.mergeAnonymousIntoCustomer(ctx.anonymousCartToken, {
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
        return cartMerge ? { cartMerge } : {};
      },
    }),
    catalogModule({
      emFactory: em,
      eventBus,
      commandBus,
      requireAdmin,
      auditLogService,
      requireApiKey: integrations.handle.requireApiKey,
      salesChannelMembership: salesChannels.handle.membershipService,
      languageService: i18n.handle.languageService,
      adminNotificationService: adminNotifications.handle.adminNotificationService,
      mailer: organizationsMailer,
      // Principle X — durable BullMQ queue for bulk operations. The consumer
      // (BullMQ worker) runs co-located here unless BACKEND_ROLE=api, in which
      // case it runs only in the separate `pnpm worker` process.
      redis,
      runBulkOperationWorker: runWorkers,
      // Full Meilisearch reindex (the `search:reindex` CLI equivalent),
      // run as a `search_reindex` bulk operation when an attribute's
      // `searchable` flag flips. A fresh indexer reads Meili config from env,
      // exactly like the CLI.
      reindexSearchIndexes: async () => {
        const indexer = new SearchIndexer();
        const results = await indexer.reindexAllChannels(em());
        const documentCount = results.reduce((sum, r) => sum + r.documentCount, 0);
        return { documentCount };
      },
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
      // Storefront product-image placeholder (general.product_image_placeholder_url),
      // resolved global-or-per-channel through the SettingsService. Returns null
      // (no placeholder) when unset or on any resolution error so a settings
      // hiccup can never break product listings.
      resolveProductImagePlaceholderUrl: async (salesChannelCode) => {
        try {
          const channel = salesChannelCode
            ? await salesChannels.handle.resolver.getByCode(salesChannelCode)
            : await salesChannels.handle.resolver.getSystemDefault();
          const channelId = channel?.id ?? platformSettingsChannelId;
          const url = await settings.handle.settingsService.get(
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
    }),
    inventoryModule({
      emFactory: em,
      requireCustomer,
      resolveCustomerContext: customerResolver,
      requireAdmin,
      eventBus,
      channelResolver: salesChannels.handle.resolver,
      templateEmail: makeOrgTemplateEmail({
        getSender: () => transactionalEmailSender,
        resolveScopeSalesChannelId,
        resolveLanguage: resolveSalesChannelLanguage,
      }),
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
  modules.push(mfa.plugin);

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

  // Feature 046 — PWA module. Owns the installable-app control plane (over the
  // Settings module), the push-subscription registry, the provider-agnostic
  // push fan-out (BullMQ; co-located unless BACKEND_ROLE=api), and the icon
  // rendition pipeline (sharp + assets_library). Channel/asset/customer coupling
  // is injected here so the module stays isolated (Principle I).
  const pwa = pwaModule({
    emFactory: em,
    redis,
    runWorkers,
    settings: settings.handle.settingsService,
    settingsWrite: settings.handle.adminService,
    requireAdmin,
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
      return (await salesChannels.handle.resolver.getSystemDefault())?.id ?? platformSettingsChannelId;
    },
    defaultChannelId: async () =>
      (await salesChannels.handle.resolver.getSystemDefault())?.id ?? platformSettingsChannelId,
    channelCodeForId: async (channelId) => {
      const ch = await em().findOne(SalesChannel, { id: channelId });
      return ch?.code ?? null;
    },
    resolveAuditContext: (request) => ({
      actorAdminUserId: request.actor.kind === 'admin' ? request.actor.adminUserId : null,
    }),
    vapidSubject: process.env['PWA_VAPID_SUBJECT'] ?? 'mailto:admin@b2b-platform.local',
    resolveCustomerAccountId: async (request) =>
      request.actor.kind === 'customer' ? request.actor.customerAccountId : null,
    // FR-024 auto-trigger — resolve an order-status event into a push target
    // (the placing customer + a deep link to their order). Reading the Order
    // entity here keeps the pwa module decoupled from the orders module.
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
        return rows[0]?.slug ? `/c/${rows[0].slug}` : null;
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
    // Typeahead suggestions carry the per-customer price-list resolution so
    // the popup shows the price the searching user would actually pay,
    // honouring their price list and price-visibility (feature 011).
    enrichSuggestionPricing: createSuggestionPricingEnricher({
      emFactory: em,
      pricingService: priceLists.handle.pricingService,
    }),
    resolveAdminAuditContext: (request) => {
      if (request.actor.kind !== 'admin') return { actorAdminUserId: null };
      return { actorAdminUserId: request.actor.adminUserId };
    },
    // Periodic full Meilisearch reindex — interval from Settings
    // (`search.reindex_interval_minutes`, default 10; 0 disables). The sweep
    // runs co-located unless BACKEND_ROLE=api, exactly like the other workers.
    enableReindexScheduler: runWorkers,
    resolveReindexIntervalMinutes: async () => {
      try {
        return await settings.handle.settingsService.get(
          SEARCH_SETTING_CODES.REINDEX_INTERVAL_MINUTES,
          'default',
          z.number().int().nonnegative(),
        );
      } catch {
        return DEFAULT_REINDEX_INTERVAL_MINUTES;
      }
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
    // Business Quote Request ID prefix/suffix — global (not Sales-Channel
    // scoped). Missing settings resolve to '' (bare numeric ID).
    resolveBusinessIdPrefix: async () => {
      try {
        const { z } = await import('zod');
        return await settings.handle.settingsService.get(
          QUOTE_REQUESTS_SETTING_CODES.BUSINESS_ID_PREFIX,
          'default',
          z.string(),
        );
      } catch {
        return '';
      }
    },
    resolveBusinessIdSuffix: async () => {
      try {
        const { z } = await import('zod');
        return await settings.handle.settingsService.get(
          QUOTE_REQUESTS_SETTING_CODES.BUSINESS_ID_SUFFIX,
          'default',
          z.string(),
        );
      } catch {
        return '';
      }
    },
    assertOrganizationCanTransact,
    // Quote Request prices are net; the VAT rate is resolved from the
    // Organization's VAT status + tax rules at read time (mirrors Orders).
    // VAT-exempt / reverse-charge Organizations resolve to 0.
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
  });
  modules.push(quoteRequests.register);

  // Feature 040 — Customers module. Built after orders + quote_requests so it
  // can reach the OrderListService (late-bound) and the RfqService for the
  // self-service order / RFQ history endpoints.
  const customers = customersModule({
    emFactory: em,
    sessionService,
    requireCustomer,
    resolveCustomerActor: (request) => {
      if (request.actor.kind !== 'customer') {
        throw new HttpError(
          401,
          ERROR_CODES.UNAUTHORIZED,
          'Customer session required.',
        );
      }
      return {
        customerAccountId: request.actor.customerAccountId,
        organizationId: request.actor.organizationId ?? null,
      };
    },
    resolveAllowRegistrationWithoutOrganization: async () => {
      try {
        const { z } = await import('zod');
        const channel = await salesChannels.handle.resolver.getSystemDefault();
        if (!channel) return false;
        return await settings.handle.settingsService.get(
          CUSTOMERS_SETTING_CODES.ALLOW_REGISTRATION_WITHOUT_ORGANIZATION,
          channel.id,
          z.boolean(),
        );
      } catch {
        // Setting not seeded / out-of-scope — default closed (org required).
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
    organizationRestrictionService,
    requireAdmin,
    vatValidator: new ViesClient(),
    mailer: organizationsMailer,
    storefrontBaseUrl: process.env['STOREFRONT_BASE_URL'] ?? 'http://localhost:3000',
    resolveDeletionRetentionDays: async () => {
      try {
        const { z } = await import('zod');
        const channel = await salesChannels.handle.resolver.getSystemDefault();
        if (!channel) return 365;
        return await settings.handle.settingsService.get(
          CUSTOMERS_SETTING_CODES.DELETION_RETENTION_DAYS,
          channel.id,
          z.number(),
        );
      } catch {
        return 365;
      }
    },
    resolvePresenceFreshnessMinutes: async () => {
      try {
        const { z } = await import('zod');
        const channel = await salesChannels.handle.resolver.getSystemDefault();
        if (!channel) return 10;
        return await settings.handle.settingsService.get(
          CUSTOMERS_SETTING_CODES.PRESENCE_FRESHNESS_MINUTES,
          channel.id,
          z.number(),
        );
      } catch {
        return 10;
      }
    },
    resolveModerationActor: async (request) => {
      const actor = request.actor;
      if (actor.kind !== 'admin') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
      }
      const knex = em().getKnex();
      const roleRow = (await knex.raw(
        `select ar."code" as code from "admin_users" au left join "admin_roles" ar on ar."id" = au."admin_role_id" where au."id" = ?`,
        [actor.adminUserId],
      )) as { rows: Array<{ code: string | null }> };
      const isPlatformAdmin = (roleRow.rows[0]?.code ?? null) !== 'sales_representative';
      let allowedOrganizationIds: string[] = [];
      if (!isPlatformAdmin) {
        const rows = (await knex.raw(
          `select "organization_id" from "organization_sales_rep_assignments" where "admin_user_id" = ?`,
          [actor.adminUserId],
        )) as { rows: Array<{ organization_id: string }> };
        allowedOrganizationIds = rows.rows.map((r) => r.organization_id);
      }
      return { adminUserId: actor.adminUserId, isPlatformAdmin, allowedOrganizationIds };
    },
  });
  modules.push(customers.plugin);

  // Feature 047 — Invoices. Owns issuance, numbering, PDF rendering, admin +
  // customer routes. Constructed before returns so the corrective-invoice
  // provider can draw correction numbers from the shared number generator.
  const invoices = invoicesModule({
    emFactory: em,
    eventBus,
    requireAdmin,
    requireCustomer,
    settingsService: settings.handle.settingsService,
    audit: auditLogService,
    resolveAdminUserId: (req) => adminContextResolver(req).adminUserId,
    resolveCustomerContext: (req: FastifyRequest) => {
      const c = customerResolver(req);
      return { customerAccountId: c.customerAccountId, organizationId: c.organizationId };
    },
    getTransactionalEmailSender: () => transactionalEmailSender,
    resolveRecipientEmail: async (order) =>
      (await em().findOne(CustomerAccount, { id: order.placedByCustomerAccountId }))?.email ?? null,
    resolveLanguage: async (salesChannelId) =>
      (salesChannelId
        ? (await em().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage
        : null) ?? 'en-US',
  });
  modules.push(invoices.plugin);

  // Feature 046 — Returns & Complaints (Refunds, RMA). Reads order facts only
  // through the OrderReturnContextPort (Principle I); settings drive the
  // free-return window and RMA prefix/suffix.
  modules.push(
    returnsModule({
      emFactory: em,
      eventBus,
      settingsService: settings.handle.settingsService,
      requireCustomer,
      requireAdmin,
      resolveCustomerAccountId,
      resolveAdminUserId: (req) => adminContextResolver(req).adminUserId,
      orderContext: new OrderReturnContextProvider(em),
      paymentRefund: new PaymentRefundProvider(em),
      correctiveInvoice: new CorrectiveInvoiceProvider(em, invoices.handle.numberGenerator, auditLogService),
      creditTopup: new CreditTopupProvider(creditLimits.handle.creditLimitService),
      auditLog: auditLogService,
      notifier: new ReturnEmailNotifier(
        organizationsMailer,
        async (customerAccountId) =>
          (await em().findOne(CustomerAccount, { id: customerAccountId }))?.email ?? null,
        {
          getTransactionalEmailSender: () => transactionalEmailSender,
          resolveLanguage: async (salesChannelId) =>
            (await em().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage ?? 'en-US',
        },
      ),
    }),
  );

  // Feature 047 — Transactional Emails. Owning modules register their default
  // subject + content here; the module reconciles all manifest-declared emails
  // at boot and exposes the sender port for future send-site cutover.
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
  emailDefaultsRegistry.register('invoice_issued', {
    defaultSubject: INVOICE_ISSUED_DEFAULT.defaultSubject,
    defaultContent: INVOICE_ISSUED_DEFAULT.defaultContent,
  });
  // Feature 047 — net-new email subscribers (payment status + shipment created).
  new PaymentEmailNotifier({
    emFactory: em,
    getTransactionalEmailSender: () => transactionalEmailSender,
  }).attach(eventBus);
  new ShipmentEmailNotifier({
    emFactory: em,
    getTransactionalEmailSender: () => transactionalEmailSender,
  }).attach(eventBus);
  // Feature 049 — Stripe payment gateway. Registers the Stripe PaymentAdapter
  // + gateway refund handler into the shared singletons, seeds one
  // payment_methods row per Stripe method, and mounts the webhook / storefront /
  // admin routes. Coupling (settings, sales channels, default channel) is
  // injected so the module stays isolated (Principle I).
  modules.push(
    stripeModule({
      emFactory: em,
      eventBus,
      settingsService: settings.handle.settingsService,
      settingsAdmin: settings.handle.adminService,
      requireAdmin,
      requireCustomer,
      resolveCustomerAccountId,
      resolveAdminAuditContext: (request) => ({
        actorAdminUserId: request.actor.kind === 'admin' ? request.actor.adminUserId : null,
      }),
      resolveDefaultChannelId: async () =>
        (await salesChannels.handle.resolver.getSystemDefault())?.id ?? platformSettingsChannelId,
      salesChannelMembership: salesChannels.handle.membershipService,
      storefrontBaseUrl: process.env['STOREFRONT_BASE_URL'] ?? 'http://localhost:3000',
    }),
  );

  modules.push(
    transactionalEmailsModule({
      emFactory: em,
      settingsService: settings.handle.settingsService,
      requireAdmin,
      resolveAdminUserId: (req) => adminContextResolver(req).adminUserId,
      manifests: REGISTERED_MANIFESTS.map((e) => e.manifest),
      mailer: organizationsMailer,
      auditLog: auditLogService,
      settingsAdmin: settings.handle.adminService,
      resolveAssetUrl: async (assetId) => {
        try {
          return (await assetsLibrary.handle.service.resolveUrl(assetId)).url;
        } catch {
          return null;
        }
      },
      exposeSender: (sender) => {
        transactionalEmailSender = sender;
      },
    }),
  );

  // Feature 048 — Newsletter. Own-infrastructure bulk email: subscriber
  // signup (per-channel opt-in), campaigns, automations, and a configurable
  // sending provider. Channel/mailer/settings coupling is injected here so the
  // module stays isolated (Principle I).
  modules.push(
    newsletterModule({
      emFactory: em,
      settings: settings.handle.settingsService,
      tokenSecret:
        process.env['NEWSLETTER_TOKEN_SECRET'] ??
        process.env['SESSION_COOKIE_SECRET'] ??
        'newsletter-dev-secret',
      // Settings reads need a real channel UUID (the per-channel override
      // lookup casts to uuid); the system default channel is the platform fallback.
      platformChannelId:
        (await salesChannels.handle.resolver.getSystemDefault())?.id ?? platformSettingsChannelId,
      resolveChannelIdByCode: async (code) =>
        (await salesChannels.handle.resolver.getByCode(code))?.id ?? null,
      publicBaseUrl:
        process.env['PUBLIC_API_BASE_URL'] ??
        process.env['STOREFRONT_BASE_URL'] ??
        'http://localhost:3000',
      storefrontBaseUrl: process.env['STOREFRONT_BASE_URL'] ?? 'http://localhost:3000',
      requireAdmin,
      settingsWrite: settings.handle.adminService,
      resolveAuditContext: (request) => ({
        actorAdminUserId: request.actor.kind === 'admin' ? request.actor.adminUserId : null,
      }),
      requireCustomer,
      resolveCustomerAccountId,
      loadCustomerEmail: async (customerAccountId) =>
        (await em().findOne(CustomerAccount, { id: customerAccountId }))?.email ?? null,
      mailer: organizationsMailer,
      auditLog: auditLogService,
      emitEvent: (name, payload) =>
        eventBus.emit(name, {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          ...payload,
        }),
      redis,
      runWorkers,
    }),
  );

  // Feature 049 — Google Analytics. GA4 integration: per-channel activation +
  // Measurement ID, Enhanced Ecommerce, custom events, and server-side tagging.
  // Config lives in the Settings module; server-side delivery is queue-backed.
  modules.push(
    googleAnalyticsModule({
      emFactory: em,
      settings: settings.handle.settingsService,
      requireAdmin,
      channels: {
        idByCode: async (code) =>
          (await salesChannels.handle.resolver.getByCode(code))?.id ?? null,
        codeById: async (id) => {
          const { items } = await salesChannels.handle.salesChannelsService.list({});
          return items.find((c) => c.id === id)?.code ?? null;
        },
      },
      resolveAuditContext: (request) => ({
        actorAdminUserId: request.actor.kind === 'admin' ? request.actor.adminUserId : null,
      }),
      auditLog: auditLogService,
      redis,
      runWorkers,
      // On-demand storefront cache invalidation: any google_analytics.* setting
      // change (and custom-event CRUD) revalidates the storefront `ga:config`.
      onSettingChanged: (handler) =>
        eventBus.on('settings.value_changed', (payload) =>
          handler((payload as unknown as { settingCode: string }).settingCode),
        ),
      ...(process.env['STOREFRONT_BASE_URL']
        ? { storefrontBaseUrl: process.env['STOREFRONT_BASE_URL'] }
        : {}),
      ...(process.env['REVALIDATE_SECRET']
        ? { revalidateSecret: process.env['REVALIDATE_SECRET'] }
        : {}),
    }),
  );

  // Shopping lists / quick order — depends on the RFQ service built above
  // so the "convert to RFQ" flow goes through the new createForCustomer API.
  modules.push(
    shoppingListsModule({
      emFactory: em,
      rfqService: quoteRequests.handle().rfqService,
      requireCustomer,
      resolveCustomerContext: customerResolver,
      // Provision the customer's default shopping list eagerly on creation.
      eventBus,
      // Feature 027 — late-bind the service for the carts module's
      // save-to-list bridge (commerceModule's pushLineToShoppingList).
      exposeShoppingListService: (svc) => {
        shoppingListService = svc;
      },
      // Feature 039 — resolve the quick-order import row cap from settings,
      // register the admin on-behalf quick-order routes, and wire the
      // default-preferences routes (audit + org allow-list eligibility).
      settingsService: settings.handle.settingsService,
      requireAdmin,
      auditLog: auditLogService,
      organizationRestriction: organizationRestrictionService,
      resolveAdminContext: adminContextResolver,
      // Feature 039 — one-click buy: lazy OrderService + the enabled setting.
      getOrderService: () => orderServiceForOneClick,
      resolveOneClickEnabled: async (salesChannelId) => {
        try {
          const { z } = await import('zod');
          return await settings.handle.settingsService.get(
            QUICK_ORDER_SETTING_CODES.ONE_CLICK_BUY_ENABLED,
            salesChannelId,
            z.boolean(),
          );
        } catch {
          return false;
        }
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

  permissionCatalogueService.setEnabledModuleIdsAccessor(() => registryCache.enabledIds());
  redisSubscriber.on('message', (channel) => {
    if (channel === STATE_CHANGED_CHANNEL) {
      permissionCatalogueService.invalidate();
    }
  });

  modules.push(lifecycle.plugin);
  modules.push(adminI18n.plugin);
  modules.push(adminActions.plugin);

  // Feature 043 — prompt assistant for the admin command palette. The module
  // owns the registry port; catalog/inventory contribute their tool handlers
  // here (adapter-registry pattern — Principle I).
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
      (await salesChannels.handle.resolver.getSystemDefault())?.id ?? platformSettingsChannelId,
    permissionService,
    isModuleInstalled: (moduleId) => registryCache.isEnabled(moduleId),
    requireAdmin,
    resolveAdminContext: adminContextResolver,
    auditLogService,
    bulkProgressResolver: catalogBulkProgressResolver(catalogToolDeps),
  });
  // Feature 043 — per-module AI-assistant command registration.
  //
  // Each module contributes its prompt-action tools (resolvers + mutations) as
  // a flat `PromptActionTool[]`; the registry validates `<moduleId>.*` id
  // prefixing, uniqueness, and the mutation-preview rule on `register()`.
  // Onboarding a new module's assistant commands is exactly one entry here —
  // see `prompt_actions/PROMPT_TOOLS.md` for the contribution contract.
  const promptActionToolProviders: PromptActionTool[] = [
    ...catalogPromptResolverTools(catalogToolDeps),
    ...catalogPromptMutationTools(catalogToolDeps),
    ...inventoryPromptTools({ emFactory: em, eventBus, auditLogService }),
    ...ordersPromptTools({
      emFactory: em,
      getTransitionService: () => orderTransitionServiceForPrompts,
    }),
  ];
  for (const tool of promptActionToolProviders) {
    promptActions.handle.registry.register(tool);
  }
  modules.push(promptActions.plugin);

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
    promptActionsSettingsManifest,
    pwaSettingsManifest,
    transactionalEmailsSettingsManifest,
    newsletterSettingsManifest,
    googleAnalyticsSettingsManifest,
    invoicesSettingsManifest,
    stripeSettingsManifest,
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
    commandBus,
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
