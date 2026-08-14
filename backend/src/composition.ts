import type { AssetsLibraryCradle } from './modules/assets_library/backend.js';
import type { CustomerAccountsCradle } from './modules/customer_accounts/backend.js';
import type { PaymentAdapterRegistry } from './modules/payment_methods/services/payment-adapter-registry.js';
import type { OrderStatusRegistry } from './modules/payment_methods/services/order-status-registry.port.js';
import type { ShippingAdapterRegistry } from './modules/delivery_methods/services/shipping-adapter-registry.js';
import type { ShippingMethodEligibilityService } from './modules/delivery_methods/services/shipping-method-eligibility.js';
import { builtInPaymentAdapters } from './modules/payments/adapters/built-in-adapters.js';
import type { CredentialsService } from './modules/credentials/services/credentials.service.js';
import type { AdminNotificationService } from './modules/admin_notifications/services/admin-notification-service.js';
import type { CurrencyService } from './modules/currencies/services/currency-service.js';
import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { z } from 'zod';
import { CustomerAccount } from './modules/customer_accounts/entities/customer-account.entity.js';
import { resolveCustomerRollupSubtreeIds } from './modules/customer_accounts/services/customer-rollup-scope.js';
import { AdminUser } from './modules/admin_users/entities/admin-user.entity.js';
import { Organization } from './modules/organizations/entities/organization.entity.js';
import { AdminRole } from './modules/admin_roles/entities/admin-role.entity.js';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from './http/error-envelope.js';
import type { ModulePlugin } from './http/server.js';
import { ApiInterceptorRegistry } from './http/interceptors/index.js';
import type { ErrorEnvelopeOptions } from './http/error-envelope.js';
import { initOrm, closeOrm } from './db/index.js';
import { EventBus } from './events/bus.js';
import { CommandBus } from './commands/index.js';
import { forkScopedEm } from './tenancy/scoped-em.js';
import { type TenantContext } from './tenancy/tenant-context.js';
import { resolveTenantContext, systemTenantContext } from './tenancy/resolve-tenant-context.js';
import { withSystemScope } from './tenancy/escape-hatch.js';
import { enterSystemScope } from './kernel/scope.js';
import { registerRequestScopeHook } from './kernel/request-scope-hook.js';
// Feature 072 — the generated module list and how a root still walks it in two
// passes while the hand-wired remainder sits between them.
import { MODULES } from './composition.generated.js';
import { earlyPassModules, latePassModules } from './composition-passes.js';
import {
  composeModules,
  createRootContainer,
  createRegistrationOwnership,
  registerOrm,
  registerValues,
} from './kernel/index.js';
import { promoteAdminActor } from './modules/auth/plugin.js';
import type {
  RequireAdminAnyFactory,
  RequireAdminFactory,
} from './kernel/ports/require-admin.js';
import { AuditLogService } from './kernel/audit/audit-log-service.js';
import type { PermissionService } from './modules/admin_roles/services/permission-service.js';
import type { PermissionCatalogueService } from './modules/admin_roles/services/permission-catalogue.service.js';
import type { AdminRoleService } from './modules/admin_roles/services/admin-role-service.js';
import type { AuthCradle } from './modules/auth/backend.js';
import {
  publishStateChanged,
  registryCache,
  STATE_CHANGED_CHANNEL,
} from './modules/_lifecycle/services/registry-cache.js';
import { effectiveState } from './modules/_lifecycle/services/effective-state.js';
import { StorefrontRevalidator } from './http/storefront-revalidator.js';
import { catalogModule } from './modules/catalog/plugin.js';
import { quoteRequestsModule } from './modules/quote_requests/plugin.js';
import { organizationsModule } from './modules/organizations/plugin.js';
import { OrganizationModerationService } from './modules/organizations/services/organization-moderation-service.js';
import { OrganizationRestrictionService } from './modules/organizations/services/organization-restriction-service.js';
import { OrganizationEffectivePriceListsService } from './modules/organizations/services/organization-effective-pricelists-service.js';
import { OrganizationTreeService } from './modules/organizations/services/organization-tree-service.js';
import { OrganizationInheritanceService } from './modules/organizations/services/organization-inheritance-service.js';
import { SalesRepAssignmentService } from './modules/organizations/services/sales-rep-assignment-service.js';
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
// Feature 072 (T079) — `email` is composed through the kernel. The driver
// decision that used to sit in this file is one registration in its
// `backend.ts`; what stays here is the pure URL helper, which is a function,
// not a service, and the cradle shape the senders below resolve through.
import type { EmailCradle } from './modules/email/backend.js';
import { absolutizePublicUrl } from './modules/email/absolutize-public-url.js';
import { commerceModule } from './modules/orders/plugin.js';
// Feature 046 — Returns & Complaints (Refunds, RMA).
import type { ReturnsBridge } from './modules/returns/backend.js';
import { OrderReturnContextProvider } from './modules/orders/services/order-return-context.js';
import { PaymentRefundProvider } from './modules/payments/services/payment-refund.js';
import { CorrectiveInvoiceProvider } from './modules/invoices/services/corrective-invoice.js';
import type { InvoicesBridge, InvoicesCradle } from './modules/invoices/backend.js';
import type { KsefCradle } from './modules/ksef/backend.js';
import { productFeedsModule } from './modules/product_feeds/plugin.js';
import { CreditTopupProvider } from './modules/credit_limits/services/credit-topup.js';
import { ReturnEmailNotifier } from './modules/returns/services/return-email-notifier.js';
import type { AddressService } from './modules/addresses/services/address-service.js';
import type { OrderListService } from './modules/orders/services/order-list-service.js';
import type { OrderTransitionService } from './modules/orders/services/order-transition-service.js';
import { customersModule } from './modules/customers/plugin.js';
import { CUSTOMERS_SETTING_CODES } from './modules/customers/manifest.js';
import type { OrderService } from './modules/orders/services/order-service.js';
import { QUICK_ORDER_SETTING_CODES } from './modules/quick_order/manifest.js';
import type { AdminUsersCradle } from './modules/admin_users/backend.js';
import type { MfaActorBridge, MfaCradle } from './modules/mfa/backend.js';
import type { MfaLoginPort } from './modules/auth/services/mfa-login-port.js';
import { verifyPassword, hashPassword } from './modules/auth/services/password-hasher.js';
import {
  OpenIdOAuthProvider,
  readOAuthConfigFromEnv,
  type OAuthProviderPort,
} from './modules/mfa/services/oauth-provider-service.js';
import { StockLevelService } from './modules/inventory/services/stock-level-service.js';
import { WarehouseChannelService } from './modules/inventory/services/warehouse-channel-service.js';
import { shoppingListsModule } from './modules/shopping_lists/plugin.js';
import type { CreditLimitsCradle } from './modules/credit_limits/backend.js';
import type { CustomFieldsCradle } from './modules/custom_fields/backend.js';
import type { ApiKeysCradle } from './modules/api_keys/backend.js';
// Feature 062 (T029) — outbound webhook delivery pipeline.
import {
  createWebhookWorker,
} from './modules/webhooks/services/webhook-queue.js';
import { createDeliveryProcessor } from './modules/webhooks/services/webhook-delivery-worker.js';
import type { WebhooksCradle } from './modules/webhooks/backend.js';
import type { LanguagesCradle } from './modules/languages/backend.js';
import type { CmsCradle } from './modules/cms/backend.js';
import type { MegamenuCradle } from './modules/megamenu/backend.js';
import type { TargetValidatorDeps } from './modules/megamenu/services/target-validator.js';
import type { StorefrontDeps } from './modules/megamenu/services/storefront-resolver.js';
import { registerMegamenuAssetReferences } from './modules/megamenu/services/asset-references.js';
import { registerMegamenuCmsReferences } from './modules/megamenu/services/cms-references.js';
import type { PriceListsCradle } from './modules/price_lists/backend.js';
import { DEFAULT_PRICING_CACHE_TTL_MS } from './modules/price_lists/services/pricing-cache.js';
import type { TaxesCradle } from './modules/taxes/backend.js';
import type { PromotionsCradle } from './modules/promotions/backend.js';
import { composeSettingsKernel } from './kernel/settings/compose.js';
import type { SettingsCradle } from './modules/settings/backend.js';
import { ManifestReconciler } from './kernel/settings/manifest-reconciler.js';
import { composeSalesChannelsKernel } from './kernel/sales-channels/compose.js';
import type { SalesChannelsCradle } from './modules/sales_channels/backend.js';
import { DefaultChannelReconciler } from './kernel/sales-channels/default-channel-reconciler.js';
import { SearchIndexer } from './modules/search/services/search-indexer.js';
import type { ComparisonsCradle } from './modules/comparisons/backend.js';
import { QUOTE_REQUESTS_SETTING_CODES } from './modules/quote_requests/manifest.js';
// Feature 058 — Credentials (reusable credential configurations).
import { configurationTypeRegistry } from './modules/credentials/services/registry-singleton.js';
import { llmConfigurationType } from './modules/credentials/types/llm.type.js';
import { emailAdapterConfigurationType } from './modules/credentials/types/email-adapter.type.js';
import { ergonodeConfigurationType } from './modules/pim_ergonode/services/ergonode-credential.type.js';
import { feedDeliveryConfigurationType } from './modules/product_feeds/services/delivery/delivery-credential.type.js';
// Feature 046 — Progressive Web App.
import type { PwaBridge } from './modules/pwa/backend.js';
// Feature 047 — Transactional Emails.
import { transactionalEmailsModule } from './modules/transactional_emails/plugin.js';
import type { BrandingService } from './modules/transactional_emails/services/branding.service.js';
// Feature 048 — Newsletter.
import type { NewsletterBridge } from './modules/newsletter/backend.js';
// Feature 049 — Google Analytics.
// Feature 063 — LinkedIn Ads.
// Feature 064 — Meta Ads.
// Feature 066 — Google Tag Manager.
import { collectRegisteredSettingsManifests } from './modules/settings/services/registered-settings-manifests.js';
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
import { SalesChannel } from './kernel/sales-channels/sales-channel.entity.js';
import { Order } from './modules/orders/entities/order.entity.js';
import {
  catalogBulkProgressResolver,
  catalogPromptMutationTools,
  catalogPromptResolverTools,
} from './modules/catalog/prompt-tools.js';
import { inventoryPromptTools } from './modules/inventory/prompt-tools.js';
import { ordersPromptTools } from './modules/orders/prompt-tools.js';
import type {
  PromptActionTool,
  PromptActionToolRegistry,
} from './modules/prompt_actions/services/tool-registry.js';
import { Asset } from './modules/assets_library/entities/asset.entity.js';
import { lifecycleModuleFromStaticEntries } from './modules/_lifecycle/plugin.js';
import {
  REGISTERED_MANIFESTS,
  type RegisteredManifestEntry,
} from './modules/_lifecycle/registered-manifests.js';
// Feature 057 — per-deployment overlay resolution (build/composition-time).
import {
  discoverOverlayModuleManifests,
  loadOverlayDecorations,
  loadOverlayModulePlugins,
} from './overlay/overlay-runtime.js';
import type { PricingServiceContract } from './modules/price_lists/services/pricing-service.interface.js';
import type { AdminI18nCradle } from './modules/_i18n/backend.js';
import type { AdminActionsCradle } from './modules/admin_actions/backend.js';
import { registerCatalogAssetReferences } from './modules/catalog/services/asset-references.js';
import { registerCmsAssetReferences } from './modules/cms/services/asset-references.js';
import { WarehouseChannelReconciler } from './modules/inventory/services/warehouse-channel-reconciler.js';
import { CatalogQueryService } from './modules/catalog/services/catalog-query.service.js';
import { CatalogAttributeReadService } from './modules/catalog/services/catalog-attribute-read.service.js';
// Feature 068 — the catalogue write surface the Ergonode connector imports through.
import {
  CatalogAdminService,
  type CatalogEventBus,
} from './modules/catalog/services/catalog-admin.service.js';
import { CategoryAdminService } from './modules/catalog/services/category-admin.service.js';
import { AttributeSetService } from './modules/catalog/services/attribute-set.service.js';
import { GalleryService } from './modules/catalog/services/gallery.service.js';
import { AttachmentService } from './modules/catalog/services/attachment.service.js';
import { ProductLinkService } from './modules/catalog/services/product-link.service.js';
import { GroupedService } from './modules/catalog/services/grouped.service.js';
import { pimErgonodeModule } from './modules/pim_ergonode/plugin.js';
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
  /**
   * Feature 060 — the API interceptor registry. index.ts passes it to
   * `buildServer({ apiInterceptors })`; modules receive it through their
   * factory options / OverlayModuleContext and register during composition.
   */
  apiInterceptors: ApiInterceptorRegistry;
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
  // Feature 050 — the single EM-injection seam. `forkScopedEm` is a bare
  // `orm.em.fork()`: it stamps NOTHING, because the tenant filters read the
  // ambient TenantContext from AsyncLocalStorage **when the query is built**
  // (`tenancy/filters.ts`), not when the manager is forked. That is what makes
  // the EntityManager stateless with respect to tenancy, and it is the property
  // the whole request seam rests on — a fork taken in one context and used in
  // another is scoped by the context it is *used* in (feature 072, T038; see
  // `test/integration/tenancy/fault-injection.test.ts`). The seam is inert until
  // an entity is classified (@OrgScoped/@CustomerScoped attach the filters).
  const em = (): EntityManager => forkScopedEm(orm);

  // Feature 072 — the kernel container. Modules composed through
  // `composeModules` register into it; everything still hand-wired below is
  // unaffected until its own conversion lands.
  //
  // It is deliberately **not** installed as the process root
  // (`setRootContainer`). Doing so makes every `enterPlatformScope` branch a
  // child off this graph, and a scope is what lives in an `AsyncLocalStorage`
  // store — so every retained store starts pinning a whole composed
  // application. `ctx.cradle()` therefore resolves through this container
  // directly, which is also the better contract while two roots exist: what a
  // name resolves to is a property of the composition, not of where the call
  // happens.
  //
  // Phase 4 measured the cost: the suite died with `JavaScript heap out of
  // memory` at file 78 of 930 with the root installed. Phase 5 re-measured it
  // on the generated composer — the condition its deferral was pinned to — and
  // the answer did not move: file 72 of 930, 348 s, 5.1 GB. It could not have.
  // Production composes one application per process; the **test harness
  // composes 555 per run**, and that is what the retention scales with. The
  // number to change is the number of live compositions, which belongs to the
  // harness convergence (T070–T077), not to this file.
  const container = createRootContainer();
  registerOrm(container, orm);
  // One ledger for the whole boot, so two modules composed in different
  // `composeModules` calls still collide loudly on a shared registration name.
  const registrationOwnership = createRegistrationOwnership();

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

  const auditLogService = new AuditLogService(em);

  // Feature 057 — resolve the per-deployment overlay once. For a bare-core
  // build (no DEPLOYMENT / no overlay dir) all of these are empty and the wiring
  // below is byte-for-byte unchanged. `resolvedRegistry` = the hand-maintained
  // core registry + overlay-only modules (the core array is never edited).
  // Feature 072 (T066) — a deployment's client overrides, as decorations
  // keyed by the registration they wrap. The overrides that reach a module
  // still hand-wired here are handed to it; once a module is converted its
  // override becomes `ctx.di.decorate` and this lookup disappears with the
  // hand-wiring.
  const overlayDecorations = await loadOverlayDecorations();
  const decoratePricingService = overlayDecorations.get('pricingService') as
    | ((inner: PricingServiceContract) => PricingServiceContract)
    | undefined;
  const overlayModuleManifests = await discoverOverlayModuleManifests();
  const resolvedRegistry: RegisteredManifestEntry[] = [
    ...REGISTERED_MANIFESTS,
    ...overlayModuleManifests.map((m) => ({ manifest: m.manifest, filePath: m.filePath })),
  ];


  const eventBus = new EventBus();

  // Feature 054 (Principle XIII) — the Command Bus: the single, guaranteed audit
  // writer for sensitive writes. It forks the scoped EM, runs the write + one
  // audit insert co-transactionally, and dispatches the domain event on commit.
  // Threaded into module factories alongside `eventBus` as writes are migrated.
  const commandBus = new CommandBus(orm, auditLogService, eventBus);

  // Feature 060 — API interceptor registry. Modules register pre/post
  // interceptors against endpoints owned by other modules; execution is
  // lifecycle-gated per interceptor via the enabled-set cache predicate.
  const apiInterceptors = new ApiInterceptorRegistry({
    isModuleEnabled: (moduleId) => registryCache.isEnabled(moduleId),
  });

  // Feature 072 — the early pass of the **generated** module list
  // (`composition.generated.ts`). Nothing about these modules is named here any
  // more: the list is a walk of the tree, so adding a module is adding a folder
  // and removing one is deleting it.
  //
  // They are composed ahead of the hand-wired remainder because what they
  // register is read by it — `emailMailer` by six senders below — and because
  // `health_checks` must contribute its routes before the auth plugin. See
  // `composition-passes.ts` for why there are two passes at all; both share one
  // ownership ledger, so a name registered twice still collides naming both
  // modules.
  //
  // `redis` is registered here rather than beside the late pass because
  // `health_checks` pings it: a host name belongs where the value first exists,
  // and the client has existed since the top of this function.
  registerValues(container, {
    redis,
    // Feature 072 (T125) — the interceptor registry, so `_lifecycle` can serve
    // the read-only diagnostics screen over it. It was already declared
    // platform-owned; until this conversion nothing resolved it by name, so
    // nothing noticed that no root registered it.
    apiInterceptors,
    // The one connection ioredis has put into subscriber mode. Shared, because
    // a subscriber connection cannot serve commands: a per-module one would
    // cost a socket per module and buy nothing.
    redisSubscriber,
    // Modules announce on it; `ctx.subscribe` receives on it. A module that
    // publishes needs it as a registration, not just as a composer option.
    eventBus,
    // The audited write path (Principle XIII). A converted module resolves it
    // like any other platform service.
    commandBus,
    // The resolved registry — core manifests plus this deployment's overlay
    // modules. `admin_roles` builds the permission catalogue from it and cannot
    // see it itself: which modules a deployment ships is a composition-root
    // input, not something a module decides.
    resolvedModuleRegistry: resolvedRegistry,
    auditLogService,
  });
  const earlyModules = composeModules(earlyPassModules(MODULES), {
    container,
    eventBus,
    // Composition runs before `buildServer`, so there is no `app.log` yet.
    log: console,
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

  // Feature 072 (T078) — `auth` owns these now. Resolved rather than
  // constructed, so production and the test harness get the same instances
  // from the same registration instead of each building their own.
  const authCradle = container.cradle as unknown as AuthCradle & {
    requireAdmin: RequireAdminFactory;
    requireAdminAny: RequireAdminAnyFactory;
  };
  const sessionService = authCradle.sessionService;

  // Feature 072 (wave 1) — `admin_roles` owns these three now.
  const rolesCradle = container.cradle as unknown as {
    permissionService: PermissionService;
    permissionCatalogueService: PermissionCatalogueService;
    adminRoleService: AdminRoleService;
  };
  const permissionService = rolesCradle.permissionService;
  const permissionCatalogueService = rolesCradle.permissionCatalogueService;

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

  // ---- Cross-cutting actor resolvers --------------------------------------

  const requireCustomer = async (request: FastifyRequest): Promise<void> => {
    if (request.actor.kind !== 'customer') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
    }
  };

  // Feature 072, T011/T012 — one guard implementation, owned by `auth` and
  // shared with the test harness. It used to be declared inline here while the
  // harness ran its own copy that read a different request property and took
  // `permissionService` as optional.
  const requireAdmin = authCradle.requireAdmin;
  const requireAdminAny = authCradle.requireAdminAny;

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
  // Feature 072 (T100) — `api_keys` owns its service, its two gates and its
  // routes now, and provides `apiKeyResolver` itself.
  const apiKeysCradle = container.cradle as unknown as ApiKeysCradle;

  // Feature 062 (T029 / FR-014) — outbound webhook delivery, org-scoped.
  // The bridge (producer) runs in every role: it maps bridged in-process
  // events onto the durable BullMQ queue, filtered per subscription through
  // `WebhookService.findActiveByEventType(eventType, organizationId)` so an
  // org-bound subscription only ever sees its own organization's events
  // (Principle XI; contracts/order-webhooks.md §2). The consumer (delivery
  // worker: HMAC signing + retries + `webhook_deliveries` bookkeeping) runs
  // co-located unless BACKEND_ROLE=api, exactly like the other workers
  // (Principle X — separable via `pnpm --filter backend run worker`).
  // Feature 072 (T098) — the queue, the EventBus bridge and the admin routes
  // are `webhooks`' own now; `api_keys` no longer builds its service either.
  // Only the delivery worker stays here, because whether workers run at all is
  // a deployment decision (`BACKEND_ROLE`), not the module's.
  const webhooksCradle = container.cradle as unknown as WebhooksCradle;
  const webhookWorker = runWorkers
    ? createWebhookWorker(
        redis,
        createDeliveryProcessor({
          recordDelivery: async (input) => {
            await webhooksCradle.webhookService.recordDelivery(input);
          },
        }),
      )
    : null;

  // Feature 072 (T078) — the auth plugin is `auth`'s own contribution now,
  // collected by `ctx.rootPlugin` because it decorates `request.actor` for the
  // whole application rather than contributing routes. The two resolvers it
  // reads are registered below, once the modules that own them exist; the
  // plugin reads them per request, so the order is not a race.
  const authModulePlugin: ModulePlugin = async (app) => {
    for (const plugin of earlyModules.sink.rootPlugins) await plugin(app);
  };

  // Feature 042 — the MFA module is constructed after `settings` exists, so its
  // login port is late-bound here and resolved lazily by the auth services.
  let mfaLoginPort: MfaLoginPort | undefined;
  const getMfaLoginPort = (): MfaLoginPort | undefined => mfaLoginPort;

  // Feature 072 (T094) — contributed to `customer_accounts`, which defaults it
  // absent. Registered after the early pass so it overrides the module's own
  // default rather than being overwritten by it; the getter is late-bound, so
  // `mfa` composing later is not a race.
  registerValues(container, { mfaLoginPortGetter: getMfaLoginPort });


  // Feature 056 — organization tree + inheritance resolution port (shared by
  // US2 scope expansion and US3 commercial-term inheritance). The global
  // credit-mode default is read from Settings at call time (settings module is
  // constructed further below; the closure runs at request time).
  const organizationTreeService = new OrganizationTreeService(em);
  const organizationInheritanceService = new OrganizationInheritanceService(
    em,
    organizationTreeService,
    async () => {
      try {
        const { z } = await import('zod');
        return await settings.settingsService.get(
          ORGANIZATIONS_SETTING_CODES.CREDIT_INHERITANCE_MODE,
          'default',
          z.enum(['shared_pool', 'independent_default']),
        );
      } catch {
        return 'shared_pool';
      }
    },
  );

  // Feature 072 (T101) — `credit_limits` owns its service and routes now.
  const creditLimitsCradle = container.cradle as unknown as CreditLimitsCradle;

  // Feature 055 — Custom Fields Layer, converted in feature 072 (T087). The
  // module owns its services, its admin API and the cross-process cache
  // subscription now; this root only reads the two ports host modules consume.
  const customFieldsCradle = container.cradle as unknown as CustomFieldsCradle;
  const customFieldDefinitionService = customFieldsCradle.customFieldDefinitionService;
  const customFieldValueService = customFieldsCradle.customFieldValueService;

  // Feature 061 — the composed attribute read model (product-host custom-field
  // definitions + catalog extension rows). Built once, threaded into catalog,
  // search, quick_order, and comparisons as the sanctioned attribute read port.
  const catalogAttributeReadService = new CatalogAttributeReadService(
    em,
    customFieldDefinitionService,
  );

  // Feature 072 (T122) — `import_export` owns its service and routes now.
  // Feature 072 (T105) — `languages` owns its services and routes now.
  const languagesCradle = container.cradle as unknown as LanguagesCradle;

  // Feature 005 — Sales Channels module. The boot-time
  // DefaultChannelReconciler runs FIRST so every other module can rely on a
  // system-default channel existing; it must precede the modules array
  // because catalog (and later other modules) consume
  // `salesChannels.membershipService` in their composition. The
  // plugin itself (resolver middleware) is pushed into `modules` below.
  const salesChannelsReconciler = new DefaultChannelReconciler(em, auditLogService);
  // Feature 072 (T036) — boot reconcilers establish their own scope. They ran
  // with NO ambient tenant context before, and survived only because the rows
  // they touch carry no automatic filter; that was an accident of entity
  // classification, not a guarantee.
  const salesChannelsReconciliation = await enterSystemScope(
    'boot: reconcile the default sales channel',
    () => salesChannelsReconciler.run(),
    { entryPoint: 'boot' },
  );
  if (salesChannelsReconciliation.action === 'warning' && salesChannelsReconciliation.warning) {
    console.warn(salesChannelsReconciliation.warning);
  }

  // Feature 010 — pair every active sales channel with a warehouse. Migration
  // 030 seeds the Default warehouse and tries to bind it to each channel, but
  // the seed runs BEFORE DefaultChannelReconciler creates the system channel
  // at boot. This reconciler catches up at runtime so US3 (channel→warehouse)
  // never sees a channel without at least one (default) assignment.
  await enterSystemScope(
    'boot: reconcile channel warehouses',
    () => new WarehouseChannelReconciler(em()).run(),
    { entryPoint: 'boot' },
  );

  // Feature 017 — construct the Dictionary module before its validator
  // consumers so the shared port can be threaded through their services.
  // The plugin itself is still registered later to preserve route order.
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

  // Feature 072 (T110) — the channel *resolution* machinery is kernel
  // infrastructure and stays ungated: every channel-scoped read depends on it
  // (Principle XII), so it must keep working whether or not an operator wants
  // the administration screens. The module owns the admin CRUD service and its
  // routes, and composes itself.
  const salesChannels = composeSalesChannelsKernel({
    emFactory: em,
    eventBus,
    redis,
    auditLogService,
  });
  registerValues(container, {
    salesChannelsCache: salesChannels.cache,
    // The kernel-reserved membership port. `payment_methods` and
    // `delivery_methods` resolve it to auto-bind a new method to the system
    // default channel; both are composed early, but they read it when their
    // routes register, which is after this line.
    salesChannelMembershipPort: salesChannels.membershipService,
  });

  // Feature 014 — CMS module (Pages, Blocks, Templates, Hooks, Page
  // Builder). Phase 2 ships module instantiation + seeded-Hook
  // reconciliation; admin/storefront routes land in subsequent phases.
  // Feature 072 (T093) — `cms` owns its services, its four late-bound
  // resolvers, its seeded-Hook reconciliation and its routes now. This root
  // reads only the reference registry `megamenu` cross-registers into, and
  // contributes the asset resolver further below.
  const cmsCradle = container.cradle as unknown as CmsCradle;

  // Feature 072 (T127) — `price_lists` owns its services and routes now. Three
  // names stay a composition's: whether a wall-clock status sweeper runs, how
  // long the pricing LRU holds, and how this deployment names a non-admin
  // caller on an audit record. The pricing decoration (D-28) is contributed
  // here too, when the deployment ships one.
  registerValues(container, {
    priceListsEnableStatusSweeper: true,
    priceListsPricingCacheTtlMs: DEFAULT_PRICING_CACHE_TTL_MS,
    priceListsAdminAuditContext: (request: FastifyRequest) => {
      const actor = (request as { actor?: { kind: 'admin'; adminUserId: string } }).actor;
      if (actor?.kind !== 'admin') {
        return { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
      }
      return { actorAdminUserId: actor.adminUserId };
    },
    ...(decoratePricingService ? { decoratePricingService } : {}),
  });
  // Feature 072 (T119) — `taxes` owns its service and routes now.
  const taxesCradle = container.cradle as unknown as TaxesCradle;
  // Feature 012 / US8 — promotions reads catalog through CatalogQueryService
  // (the documented cross-module port — Constitution I) so the rule editor
  // can list `isPromoRule` attributes and the resolver can validate
  // `attribute` criteria against the authoritative option list.
  const catalogQueryServiceForPromotions = new CatalogQueryService(
    em,
    undefined,
    undefined,
    catalogAttributeReadService,
  );
  // Feature 072 (T115) — `promotions` owns its services and routes now.
  // These three stay here: the org-status gate and the Rule Builder picker
  // sources read `organizations`, `categories`, `payment_methods` and
  // `delivery_methods` directly, and the catalog read port is `catalog`'s.
  // Registered after the late pass, where the module declares its defaults.
  registerValues(container, {
    catalogQueryPort: catalogQueryServiceForPromotions,
    organizationStatusResolver: async (orgId: string) => {
      const row = (await em().getKnex()
        .raw(`select "status" from "organizations" where "id" = ? and "deleted_at" is null`, [orgId])) as { rows: Array<{ status: string }> };
      return row.rows[0]?.status ?? null;
    },
    promotionRuleTargets: {
      salesChannels: async () => {
        const { items } = await (container.cradle as unknown as SalesChannelsCradle).salesChannelsService.list({});
        return items.map((c) => ({ id: c.id, code: c.code, name: anyLabel(c.name) }));
      },
      customerGroups: async () => {
        const groups = await (container.cradle as unknown as PriceListsCradle).customerGroupService.list();
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
  const promotionsCradle = container.cradle as unknown as PromotionsCradle;

  // Settings module is constructed up here (rather than further down) so its
  // SettingsService handle can be threaded into inventory + search at module
  // construction time. The plugin itself is still pushed onto `modules` below.
  // Feature 072 (T118) — the universal settings *reader* is kernel
  // infrastructure: almost every module calls `SettingsService.get`, so it
  // cannot be gated on whether an operator wants the settings screens. The
  // module owns the admin write service, the cache-clear action, the four
  // storefront resolvers and its routes, and composes itself.
  const settings = composeSettingsKernel({
    emFactory: em,
    eventBus,
    redis,
    ...(process.env['SETTINGS_SECRET_ENCRYPTION_KEY']
      ? { secretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] }
      : {}),
  });
  registerValues(container, {
    settingsSecretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'],
    // Feature 073 — the effective-state reader. Registered here rather than
    // imported inside the module so the dependency direction stays declared in
    // a root: `_lifecycle` reads this module's `Setting` rows, and this module
    // reads nothing of `_lifecycle`'s.
    settingsModulePresence: {
      presenceOf: (moduleId: string) => effectiveState.presenceOf(moduleId),
      activationControlOwner: (code: string) => effectiveState.activationControlOwner(code),
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

  // Feature 058 — Credentials module. Instantiated right after `settings` (its
  // only hard dependency) so that consumer modules constructed further down
  // (search, newsletter, prompt_actions) can receive `credentialsService`
  // for the `credential_ref` resolution path (feature 058 Phase 8). The
  // configuration-type registry is the process-wide cross-module seam; core
  // types are registered here at boot.
  configurationTypeRegistry.register(llmConfigurationType);
  configurationTypeRegistry.register(emailAdapterConfigurationType);
  configurationTypeRegistry.register(ergonodeConfigurationType);
  configurationTypeRegistry.register(feedDeliveryConfigurationType);
  // Feature 072 (wave 1) — `credentials` owns its service; the root supplies
  // the two inputs that are properties of the deployment rather than of the
  // module: the cross-module configuration-type registry, and how an admin
  // actor is resolved from a request.
  registerValues(container, {
    configurationTypeRegistry,
    adminContextResolver,
    // US2 — the delete-integrity guard reaches settings only through this port
    // (Principle I): `SettingsService.listReferencesToConfiguration`.
    credentialsSettingsPort: settings.settingsService,
  });
  const credentialsService = (
    container.cradle as unknown as { credentialsService: CredentialsService }
  ).credentialsService;

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
        allowed = await settings.settingsService.get(
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

  // Feature 072 (T096) — `mfa` owns its services, routes and configuration
  // now. What a root still owns is the *shape this composition gives an actor*:
  // production reads `request.actor`, the harness reads `request.testActor`.
  // That is contributed whole rather than as ten separate names, because a
  // composition either knows how to resolve an actor or it does not.
  registerValues(container, {
    mfaDefaultChannelIdResolver: async () =>
      (await salesChannels.resolver.getSystemDefault())?.id ?? null,
    ...(oauthProvider ? { mfaOauthProvider: oauthProvider } : {}),
    mfaSocialAccountResolvers: mfaSocialResolvers,
    mfaActorBridge: {
      resolveCustomerActor: (request: FastifyRequest) => {
        if (request.actor.kind !== 'customer') {
          throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
        }
        return {
          customerAccountId: request.actor.customerAccountId,
          organizationId: request.actor.organizationId ?? null,
        };
      },
      resolveAdminActor: (request: FastifyRequest) => {
        promoteAdminActor(request);
        if (request.actor.kind !== 'admin') {
          throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
        }
        return { adminUserId: request.actor.adminUserId };
      },
      resolveOrganizationCustomerIds: async (organizationId: string) => {
        const rows = await em().find(CustomerAccount, { organizationId }, { fields: ['id'] });
        return rows.map((r) => r.id);
      },
      resolveOrgAdmin: async (request: FastifyRequest) => {
        if (request.actor.kind !== 'customer') {
          throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
        }
        const c = await em().findOne(CustomerAccount, { id: request.actor.customerAccountId });
        if (!c || c.role !== 'organization_admin' || !c.organizationId) {
          throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Organization administrator role required.');
        }
        return { organizationId: c.organizationId, actor: c.id };
      },
      resolveAccountEmail: async (subjectType: 'customer' | 'admin', subjectId: string) => {
        const em2 = em();
        if (subjectType === 'admin') {
          const a = await em2.findOne(AdminUser, { id: subjectId });
          return a?.email ?? null;
        }
        const c = await em2.findOne(CustomerAccount, { id: subjectId });
        return c?.email ?? null;
      },
      verifyAccountPassword: async (
        subjectType: 'customer' | 'admin',
        subjectId: string,
        password: string,
      ) => {
        const em2 = em();
        if (subjectType === 'admin') {
          const a = await em2.findOne(AdminUser, { id: subjectId });
          return a ? verifyPassword(a.passwordHash, password) : false;
        }
        const c = await em2.findOne(CustomerAccount, { id: subjectId });
        return c ? verifyPassword(c.passwordHash, password) : false;
      },
    } satisfies MfaActorBridge,
  });
  const mfaCradle = container.cradle as unknown as MfaCradle;
  mfaLoginPort = mfaCradle.mfaLoginPort;

  // SEO module — needs the SettingsService port for the per-channel
  // `sales_channels.storefront_url` setting that the sitemap generator
  // stamps into URLs. Plugin is pushed onto `modules` further below.
  // Feature 072 (T117) — `seo` owns its services and routes now.

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

  // Feature 072 (T079) — the platform mailer, resolved from the container the
  // `email` module registered it into. Six senders share it, which is why it
  // was never really "the organizations mailer" and is not named one now.
  const platformMailer = (container.cradle as unknown as EmailCradle).emailMailer;

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


  const platformSettingsChannelId = process.env['ORGANIZATIONS_SETTINGS_CHANNEL_ID'] ?? 'default';

  const resolveModerationMode = async (): Promise<'auto' | 'manual'> => {
    try {
      return await settings.settingsService.get(
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
      return await settings.settingsService.get(
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
    platformMailer,
    resolveModerationMode,
  );

  // Feature 047 — org emails resolve against the system-default sales channel.
  const resolveScopeSalesChannelId = async (): Promise<string | null> =>
    (await em().findOne(SalesChannel, { systemDefault: true }))?.id ?? null;
  const resolveSalesChannelLanguage = async (salesChannelId: string): Promise<string> =>
    (await em().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage ?? 'en-US';
  const orgRegistrationNotifier = new OrgRegistrationNotifier({
    emFactory: em,
    adminNotificationService: adminNotificationService,
    mailer: platformMailer,
    resolveRecipients: resolveRegistrationRecipients,
    templateEmail: makeOrgTemplateEmail({
      getSender: () => transactionalEmailSender,
      resolveScopeSalesChannelId,
      resolveLanguage: resolveSalesChannelLanguage,
    }),
  });

  const organizationContextService = new OrganizationContextService(em);
  const organizationRestrictionService = new OrganizationRestrictionService(em, auditLogService);

  // Feature 056 — subtree-aware assignment service. When a scoped sales-rep
  // actor holds the `organizations:rollup` capability, `listAssignedOrganizationIds`
  // expands each assignment to its subtree (with per-descendant override, FR-011);
  // `canSeeOrganization` uses the nearest-assignment-on-ancestor-chain rule.
  // Without the capability, behavior is byte-for-byte the pre-feature flat set.
  // (`organizationTreeService` is constructed above, before creditLimits.)
  const scopedSalesRepAssignment = new SalesRepAssignmentService(em, auditLogService, {
    treeService: organizationTreeService,
    hasRollupCapability: (adminUserId) =>
      permissionService.hasPermission(adminUserId, 'organizations:rollup'),
  });

  /**
   * Feature 026 US6 — admin orders/RFQ visibility scope. Sales-rep admins
   * see only orders/RFQs from organizations they own; any other admin
   * (platform admin, content manager, etc.) sees everything.
   *
   * Feature 056 — the assigned set is subtree-expanded when the rep holds the
   * roll-up capability (see `scopedSalesRepAssignment`).
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
    const allowedOrganizationIds = await scopedSalesRepAssignment.listAssignedOrganizationIds(
      actor.adminUserId,
    );
    return { allowAll: false, allowedOrganizationIds };
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
  // Contributed to the two method modules, which default them absent: the
  // per-Organization allow-list is `organizations`' knowledge. Registered here,
  // after the early pass, so it overrides the modules' defaults rather than
  // being overwritten by them.
  registerValues(container, {
    organizationPaymentMethodAllowList: resolveOrganizationPaymentMethodAllowList,
    organizationDeliveryMethodAllowList: resolveOrganizationDeliveryMethodAllowList,
  });
  const resolveOrganizationWarehouseAllowList = buildOrgAllowListResolver('warehouseIds');

  const organizationEffectivePriceListsService = new OrganizationEffectivePriceListsService({
    emFactory: em,
    resolveDefaultSalesChannelId: async () => {
      const channel = await salesChannels.resolver.getSystemDefault();
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
    auditLog: auditLogService,
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

  // Feature 047 — late-bound transactional-email sender. commerceModule (and
  // other owning modules) read it via a getter; the transactional_emails module
  // sets it through exposeSender once built.
  let transactionalEmailSender: TransactionalEmailSender | undefined;
  let emailBrandingService: BrandingService | undefined;

  // Feature 050 — establish the ambient TenantContext for every request from the
  // already-authenticated actor (never from request inputs). Registered right
  // after auth so its onRequest runs after `request.actor` is set and applies
  // globally (mirrors the auth plugin). See specs/050-org-tenant-scoping/.
  //
  // Feature 072 (T027) — the same hook now also opens the request's resolution
  // scope; `registerRequestScopeHook` owns the shape, shared with the test
  // harness so the two cannot drift.
  const tenantContextModulePlugin: ModulePlugin = async (app) => {
    const buildContext = async (request: FastifyRequest): Promise<TenantContext> => {
      const actor = request.actor;
      if (actor.kind === 'customer') {
        const orgId =
          actor.organizationId && actor.organizationId.length > 0 ? actor.organizationId : null;
        // Feature 056 (T032) — a roll-up-enabled customer widens to its org
        // subtree (server-derived). Absent the capability, stays single-org.
        const rollupSubtree = await resolveCustomerRollupSubtreeIds(
          em,
          (id) => organizationTreeService.subtreeIds(id),
          actor.customerAccountId,
          orgId,
        );
        return resolveTenantContext({
          kind: 'customer',
          customerAccountId: actor.customerAccountId,
          organizationId: orgId,
          impersonatorAdminUserId: actor.impersonatorAdminUserId,
          ...(rollupSubtree && rollupSubtree.length > 0
            ? { rollupSubtreeOrganizationIds: rollupSubtree }
            : {}),
        });
      }
      if (actor.kind === 'admin') {
        const scope = await resolveAdminOrdersScope(request);
        return resolveTenantContext({ kind: 'admin', adminUserId: actor.adminUserId }, scope);
      }
      // Feature 062 — a BOUND api key pins the request to its organization +
      // designated service account; an unbound key keeps the legacy trusted
      // system scope (its only surface is the global-entity PIM path).
      if (actor.kind === 'api_key') {
        return resolveTenantContext({
          kind: 'api_key',
          apiKeyId: actor.apiKeyId,
          organizationId: actor.organizationId ?? null,
          customerAccountId: actor.customerAccountId ?? null,
        });
      }
      // anonymous: trusted platform read scope. Guest-owned rows are
      // scoped by their own token mechanism, not by the tenant filter.
      return systemTenantContext(`actor:${actor.kind}`);
    };
    await registerRequestScopeHook(app, { buildTenantContext: buildContext });
  };

  // Feature 062 — read-only inventory accessors backing the external catalog
  // namespace's availability indication (channel-candidate warehouses +
  // cumulative on-hand → display band). Standalone instances: reads only,
  // no event emission, no audit.
  const externalAvailabilityStockLevels = new StockLevelService(em);
  const externalAvailabilityWarehouseChannels = new WarehouseChannelService(em);

  const modules: ModulePlugin[] = [
    // Feature 072 — the early pass's route contribution: `health_checks`. It
    // stays ahead of the auth plugin for the reason the inline `healthPlugin`
    // did: Fastify binds a route's hook chain when the route is registered, so
    // a liveness probe registered first is one no later `onRequest` hook can
    // start authenticating.
    ...earlyModules.sink.plugins,
    authModulePlugin,
    tenantContextModulePlugin,
    // Feature 058 — Credentials (instantiated earlier, right after settings).
    commerceModule({
      paymentAdapterRegistry: methodsCradle.paymentAdapterRegistry,
      shippingAdapterRegistry: methodsCradle.shippingAdapterRegistry,
      paymentOrderStatusRegistry: methodsCradle.paymentOrderStatusRegistry,
      shippingMethodEligibility: methodsCradle.shippingMethodEligibility,
      commandBus,
      emFactory: em,
      eventBus,
      auditLogService,
      customFieldValues: customFieldValueService,
      mailer: platformMailer,
      // Feature 047 — late-bound; set once the transactional_emails module builds.
      getTransactionalEmailSender: () => transactionalEmailSender,
      creditLimit: creditLimitsCradle.creditLimitService,
      requireCustomer,
      requireAdmin,
      resolveCustomerContext: customerResolver,
      salesChannelMembership: salesChannels.membershipService,
      pricingService: (container.cradle as unknown as PriceListsCradle).pricingService,
      addressService,
      promotionService: promotionsCradle.promotionService,
      redis,
      // Feature 062 — external orders namespace (/api/v1/external/orders*):
      // bound-key gate + the org method allow-lists (FR-021 envelope).
      requireBoundApiKey: apiKeysCradle.requireBoundApiKey,
      resolveOrganizationMethodAllowLists: async (organizationId: string) => {
        try {
          const lists = await organizationRestrictionService.readAllowLists(organizationId);
          return {
            paymentMethodIds: lists.paymentMethodIds,
            deliveryMethodIds: lists.deliveryMethodIds,
          };
        } catch {
          return null;
        }
      },
      // Feature 027 US5 — abandonment-sweep resolvers + dispatcher.
      resolveCartAbandonmentInactivityMinutes: async () => {
        try {
          const { z } = await import('zod');
          return await settings.settingsService.get(
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
          return await settings.settingsService.get(
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
          return await settings.settingsService.get(
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
          return await settings.settingsService.get(
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
          return await settings.settingsService.get(
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
          return await settings.settingsService.get(
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
          return await settings.settingsService.get(
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
      // Sales-channel layer of the fulfilment-strategy precedence chain — the
      // SettingsService collapses per-channel value → global value → manifest
      // default ('default_first'). Failures degrade to that same default.
      resolveChannelFulfilmentStrategy: async (salesChannelId: string) => {
        try {
          const { z } = await import('zod');
          return await settings.settingsService.get(
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
          return await settings.settingsService.get(
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
          return await settings.settingsService.get(
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
      customerAuthService: customerAccountsCradle.customerAuthService,
      passwordResetService: customerAccountsCradle.passwordResetService,
      customerRoleService: customerAccountsCradle.customerRoleService,
      totpEnrolmentService: customerAccountsCradle.totpEnrolmentService,
      addressService,
      emFactory: em,
      eventBus,
      commandBus,
      sessionService,
      getMfaLoginPort,
      requireCustomer,
      requireAdmin,
      requireAdminAny,
      resolveCustomerContext: customerResolver,
      mailer: platformMailer,
      getTransactionalEmailSender: () => transactionalEmailSender,
      resolveScopeSalesChannelId,
      resolveSalesChannelLanguage,
      auditLogService,
      moderationService: organizationModerationService,
      restrictionService: organizationRestrictionService,
      effectivePriceListsService: organizationEffectivePriceListsService,
      taxIdValidationService: organizationTaxIdValidationService,
      customFieldValues: customFieldValueService,
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
      customFieldValues: customFieldValueService,
      customFieldDefinitions: customFieldDefinitionService,
      // Feature 061 — apply seam + composed attribute read model.
      customFieldsPort: customFieldDefinitionService,
      attributeReadService: catalogAttributeReadService,
      requireApiKey: apiKeysCradle.requireApiKey,
      // Feature 062 — external catalog namespace (/api/v1/external/catalog/*):
      // bound-key gate + the SAME pricing engine cart pricing uses (SC-001
      // parity by construction) + the inventory availability indication port.
      requireBoundApiKey: apiKeysCradle.requireBoundApiKey,
      pricingService: (container.cradle as unknown as PriceListsCradle).pricingService,
      resolveExternalAvailability: async (productIds, salesChannelId) => {
        const candidateWarehouseIds =
          await externalAvailabilityWarehouseChannels.resolveCandidateWarehouseIds(salesChannelId);
        return externalAvailabilityStockLevels.resolveAvailabilityBands(
          productIds,
          candidateWarehouseIds.length > 0 ? candidateWarehouseIds : undefined,
        );
      },
      salesChannelMembership: salesChannels.membershipService,
      languageService: languagesCradle.languageService,
      adminNotificationService: adminNotificationService,
      mailer: platformMailer,
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
        const indexer = new SearchIndexer({ attributeRead: catalogAttributeReadService });
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
            ? await salesChannels.resolver.getByCode(salesChannelCode)
            : await salesChannels.resolver.getSystemDefault();
          const channelId = channel?.id ?? platformSettingsChannelId;
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

  // Feature 013 — Assets Library. Phase 2 instantiates the module so its
  // manifest is reconciled and the AssetsLibraryService / referenceRegistry
  // are accessible to other modules. Routes (admin upload, public file
  // serving) and consumer wiring (Catalog / CMS reference descriptors) land
  // in subsequent phases (US1 + US2).
  // Feature 072 (T092) — the module owns its plugin and its registry now; the
  // root only contributes the reference resolvers of whichever modules this
  // deployment ships.
  const assetsLibrary = (container.cradle as unknown as AssetsLibraryCradle).assetsLibrary;
  // Register Catalog's reference descriptors so the Library's soft-delete
  // path (FR-030) blocks deletion of any asset still pointed at by a
  // gallery item / product attachment / virtual-download / category main
  // image.
  registerCatalogAssetReferences(assetsLibrary.handle.referenceRegistry, em);
  registerCmsAssetReferences(assetsLibrary.handle.referenceRegistry, em);
  registerMegamenuAssetReferences(assetsLibrary.handle.referenceRegistry, em);

  // Feature 072 (T093) — contributed, not set: which modules a deployment
  // ships is this root's business, and `cms` reads the contribution per call.
  registerValues(container, {
    cmsAssetResolver: async (assetId: string) => {
      try {
        const detail = await assetsLibrary.handle.service.getAsset(assetId);
        return {
          url: detail.url,
          mimeType: detail.mimeType,
          filename: detail.filename,
          label: detail.label ?? null,
          visibility: detail.visibility,
        };
      } catch {
        return null;
      }
    },
  });

  // Feature 046 — PWA module. Owns the installable-app control plane (over the
  // Settings module), the push-subscription registry, the provider-agnostic
  // push fan-out (BullMQ; co-located unless BACKEND_ROLE=api), and the icon
  // rendition pipeline (sharp + assets_library). Channel/asset/customer coupling
  // is injected here so the module stays isolated (Principle I).
  // Feature 072 (T116) — `pwa` owns its services, its queue and its routes
  // now. What stays here is every way it reaches outside itself, contributed
  // as one bridge: a composition knows how to reach `assets_library` and
  // `sales_channels`, or it does not.
  registerValues(container, {
    pwaRunWorkers: runWorkers,
    pwaBridge: {
      assetUpload: {
        upload: async (input) => {
          const detail = await assetsLibrary.handle.service.upload(input);
          return { id: detail.id };
        },
      },
      resolveAssetUrl: async (assetId: string) => {
        try {
          const resolved = await assetsLibrary.handle.service.resolveUrl(assetId);
          return absolutizePublicUrl(resolved.url);
        } catch {
          return null;
        }
      },
      resolveChannelIdByCode: async (code: string | undefined) => {
        if (code) {
          const ch = await salesChannels.resolver.getByCode(code);
          if (ch) return ch.id;
        }
        return (await salesChannels.resolver.getSystemDefault())?.id ?? platformSettingsChannelId;
      },
      defaultChannelId: async () =>
        (await salesChannels.resolver.getSystemDefault())?.id ?? platformSettingsChannelId,
      channelCodeForId: async (channelId: string) => {
        const ch = await em().findOne(SalesChannel, { id: channelId });
        return ch?.code ?? null;
      },
      resolveAuditContext: (request: FastifyRequest) => ({
        actorAdminUserId: request.actor.kind === 'admin' ? request.actor.adminUserId : null,
      }),
      resolveCustomerAccountId: async (request: FastifyRequest) =>
        request.actor.kind === 'customer' ? request.actor.customerAccountId : null,
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
    } satisfies PwaBridge,
  });

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
        // Feature 068 — a megamenu item pointing at a deactivated (or deleted)
        // category resolves to null, which drops the item from the menu.
        const rows = (await em().getConnection().execute(
          'select slug from categories where id = ? and is_active = true and deleted_at is null limit 1',
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
  // Megamenu items that reference a CMS page or block block those entities'
  // deletion via the CMS module's reference registry.
  registerMegamenuCmsReferences(
    cmsCradle.cmsReferenceRegistry,
    megamenuCradle.megamenuReferenceRegistry,
  );

  // Feature 072 — the late pass of the generated module list. No converted
  // module is named here: what this root still owns are the **host values** any
  // module may resolve — each one a port its owning module will register itself
  // once converted.
  //
  // The host names are registered where the values become available, which is
  // why this sits at the same point in the boot order the hand-written blog
  // factory call did — after `DefaultChannelReconciler`, so blog's boot hook
  // attaches the Default category to a channel that already exists.
  registerValues(container, {
    // `requireAdmin` is NOT here any more: `auth` provides it as a port
    // (T078), and re-registering the name would silently replace a gated
    // registration with an ungated value — the exact failure `providePort`
    // exists to prevent.
    // `apiKeyResolver` is NOT here either: `api_keys` provides it as a gated
    // port (T100), and re-registering the name replaced that gate with a plain
    // closure — API-key authentication kept working after the module was
    // switched off. Both roots carried the entry until the root-registration
    // check started reading them (T118).
    // `redis` is registered further up, where the client is created.
    // The kernel's `SettingsService` already implements the read port; the
    // adapter object this replaces existed only to narrow it.
    settingsReadPort: settings.settingsService,
    // Which channel a global-scope settings read resolves against. It is a
    // property of the deployment — the system-default channel, or the env
    // fallback when none is configured yet — not of any module, and this root
    // had spelled the same expression out four times.
    // Feature 072 (T096) — `mfa` resolves it. Owned by `auth` in principle and
    // still declared inline above; see the task on unifying it with the
    // harness's `requireTestCustomer()`.
    requireCustomer,
    // Feature 072 (wave 2) — how this composition resolves the calling
    // customer. Root-shaped for the same reason `requireCustomer` is: five
    // modules take it as an option and each root spells it once.
    customerContextResolver: customerResolver,
    // Feature 072 (wave 3) — how this composition names the calling customer,
    // as an id. The four payment gateways each declared an identically-shaped
    // `resolveCustomerAccountId` option and this root spelled the same
    // reference once per module.
    customerAccountIdResolver: resolveCustomerAccountId,
    // Feature 072 (T101) — inherited credit limits. Owned by `organizations`,
    // which is still hand-wired; the entry goes when that module converts.
    organizationInheritancePort: organizationInheritanceService,
    // Feature 072 (T111) — the composed attribute read model. Owned by
    // `catalog`, which is still hand-wired; the entry goes when it converts.
    catalogAttributeReadPort: catalogAttributeReadService,
    // Feature 072 (wave 2) — how this composition names the acting admin for an
    // audit record: the admin's id, or `null` for a non-admin caller. The ad
    // modules each declared an identically-shaped `resolveAuditContext` option
    // and both roots spelled the same closure once per module.
    adminAuditActorResolver: (request: FastifyRequest) => ({
      actorAdminUserId: request.actor.kind === 'admin' ? request.actor.adminUserId : null,
    }),
    // Feature 072 (wave 2) — the connection a module may build a BullMQ
    // producer queue on. Deliberately a different name from `redis`: the test
    // harness registers `redis` but must NOT hand a queue to these modules, and
    // "no queue in this composition" is a statement a root should be able to
    // make rather than something inferred from a missing option.
    moduleQueueRedis: redis,
    // Feature 072 (wave 2) — the sales-channel code⇄id lookup `google_analytics`
    // resolves. Owned by `sales_channels`, which is still hand-wired (T110).
    salesChannelCodeIdPort: {
      idByCode: async (code: string) =>
        (await salesChannels.resolver.getByCode(code))?.id ?? null,
      codeById: async (id: string) => {
        const { items } = await (container.cradle as unknown as SalesChannelsCradle).salesChannelsService.list({});
        return items.find((c) => c.id === id)?.code ?? null;
      },
    },
    settingsChannelResolver: async () =>
      (await salesChannels.resolver.getSystemDefault())?.id ?? platformSettingsChannelId,
    // Blog ships no storefront ports today — the factory defaulted this to `{}`
    // and neither composition root ever passed one.
    blogStorefrontDeps: undefined,
  });
  const lateModules = composeModules(latePassModules(MODULES), {
    container,
    eventBus,
    // Composition runs before `buildServer`, so there is no `app.log` yet.
    log: console,
    interceptorRegistry: apiInterceptors,
    ownership: registrationOwnership,
  });
  // Feature 072 (T121) — `admin_users` owns its services and routes now. The
  // MFA getter is a contribution the module defaults absent, so it is
  // registered **after the late pass** that composes `admin_users`: earlier and
  // the module's own default would overwrite it and every admin login would
  // silently go password-only. The getter is late-bound, so `mfa` composing
  // later is not a race.
  registerValues(container, { adminMfaLoginPortGetter: getMfaLoginPort });
  modules.push(...lateModules.sink.plugins);

  // Registered **after** the late pass on purpose: `audit_logs` registers its
  // own empty default there, so a value written before composition would be
  // overwritten by it (the same trap `prompt_actions` hit).
  registerValues(container, {
    // Feature 072 (T084) — `audit_logs` owns its routes now and no longer
    // reaches into `admin_users` for identities. Turning an actor id into a
    // name is a **contribution**, so it is gated here rather than declared as
    // a dependency: the audit log must stay readable when `admin_users` is
    // off, and it degrades to raw ids instead of refusing. Deciding what
    // "`admin_users` is present" means is a root's job, not the reading
    // module's; this entry disappears when `admin_users` converts and
    // publishes the resolver itself.
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
  // The explicit boot phase (FR-021): registration stays lazy, and the work
  // that genuinely has to run at boot runs here, in its own system scope.
  await lateModules.runBootHooks();

  // Feature 017 — Dictionary module. Boot reconciler populates the
  // ISO 3166-1 country catalogue, the major-currency seed metadata,
  // Polish translations for the active subset, and primary
  // language↔country associations. Idempotent — operator edits via
  // Admin UI / API are sticky across boots (FR-019). Admin + storefront
  // HTTP routes ship in user-story phases (Phase 3+); the plugin
  // currently performs the seed reconciler on first registration so
  // the platform boots with a fully populated registry.

  // Feature 006 — Search module. Owns Meilisearch indexer + event-subscriber
  // lifecycle (R-3 — moved out of catalog). Settings-aware suggest config
  // resolution + LLM-toggle wrapper hook in via the same handle.
  // Feature 072 (T123) — `search` owns its services, routes and reindex
  // cadence now. Two names stay a composition's: whether this process runs the
  // sweep, and `price_lists`' resolver, which the module narrows to a
  // suggestion price.
  registerValues(container, {
    searchRunWorkers: runWorkers,
  });

  // Feature 072 (T129) — the two adapters `inventory` reaches outside itself
  // through: the transactional-email sender that `transactional_emails`
  // announces late, and the Organization's warehouse assignment. Both are a
  // root's to build; how this deployment names a non-admin caller on an audit
  // record is too.
  registerValues(container, {
    inventoryWarehouseAllowList: resolveOrganizationWarehouseAllowList,
    inventoryTemplateEmail: makeOrgTemplateEmail({
      getSender: () => transactionalEmailSender,
      resolveScopeSalesChannelId,
      resolveLanguage: resolveSalesChannelLanguage,
    }),
    inventoryAdminAuditContext: (request: FastifyRequest) => {
      const actor = (request as { actor?: { kind: 'admin'; adminUserId: string } }).actor;
      if (actor?.kind !== 'admin') {
        return { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
      }
      return { actorAdminUserId: actor.adminUserId };
    },
  });

  // Feature 026 — Admin notifications bell. The plugin only mounts read
  // routes; writes happen via the handle (consumed above by the
  // OrgRegistrationNotifier and by future modules that emit notifications).

  // Feature 007 — Comparisons module. US1 wires the customer-facing CRUD
  // endpoints; US2/US4/US5 extend the plugin with share, PDF, and admin
  // routes respectively. Reads catalog through CatalogQueryService (the
  // documented service port — Constitution I) and `compare.max_products`
  // through SettingsService.
  // Feature 072 (T111) — the `CatalogQueryService` built here fed a parameter
  // `ComparisonService` discarded (`_catalogQuery`). Both are gone.
  // Feature 072 (T111) — `comparisons` owns its services and routes now.
  const comparisonsCradle = container.cradle as unknown as ComparisonsCradle;
  // Late-bind the adoption hook captured by organizationsModule.onLogin
  // above; from this point onwards customer logins also adopt the
  // anonymous Comparison the caller was carrying (R-2 / spec FR-005).
  comparisonAdoption = comparisonsCradle.comparisonService.adoptAnonymousComparison.bind(
    comparisonsCradle.comparisonService,
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
    customFieldValues: customFieldValueService,
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
        const value = await settings.settingsService.get(
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
        return await settings.settingsService.get(code, 'default', z.boolean());
      } catch {
        return true;
      }
    },
    // Business Quote Request ID prefix/suffix — global (not Sales-Channel
    // scoped). Missing settings resolve to '' (bare numeric ID).
    resolveBusinessIdPrefix: async () => {
      try {
        const { z } = await import('zod');
        return await settings.settingsService.get(
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
        return await settings.settingsService.get(
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
    // Feature 056 — RFQ admin scope is subtree-aware for reps holding roll-up.
    salesRepSubtree: {
      treeService: organizationTreeService,
      hasRollupCapability: (adminUserId) =>
        permissionService.hasPermission(adminUserId, 'organizations:rollup'),
    },
  });
  modules.push(quoteRequests.register);

  // Feature 040 — Customers module. Built after orders + quote_requests so it
  // can reach the OrderListService (late-bound) and the RfqService for the
  // self-service order / RFQ history endpoints.
  const customers = customersModule({
      customerAuthService: customerAccountsCradle.customerAuthService,
      passwordResetService: customerAccountsCradle.passwordResetService,
    emFactory: em,
    sessionService,
    requireCustomer,
    commandBus,
    customFieldValues: customFieldValueService,
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
        const channel = await salesChannels.resolver.getSystemDefault();
        if (!channel) return false;
        return await settings.settingsService.get(
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
    mailer: platformMailer,
    storefrontBaseUrl: process.env['STOREFRONT_BASE_URL'] ?? 'http://localhost:3000',
    resolveDeletionRetentionDays: async () => {
      try {
        const { z } = await import('zod');
        const channel = await salesChannels.resolver.getSystemDefault();
        if (!channel) return 365;
        return await settings.settingsService.get(
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
        const channel = await salesChannels.resolver.getSystemDefault();
        if (!channel) return 10;
        return await settings.settingsService.get(
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
        // Feature 056 — subtree-expanded when the rep holds `organizations:rollup`.
        allowedOrganizationIds = await scopedSalesRepAssignment.listAssignedOrganizationIds(
          actor.adminUserId,
        );
      }
      return { adminUserId: actor.adminUserId, isPlatformAdmin, allowedOrganizationIds };
    },
  });
  modules.push(customers.plugin);

  // Feature 047 — Invoices. Owns issuance, numbering, PDF rendering, admin +
  // customer routes. Constructed before returns so the corrective-invoice
  // provider can draw correction numbers from the shared number generator.
  // Feature 072 (T113) — `invoices` owns its services and routes now. What
  // stays here is how this composition reaches outside the module,
  // contributed as one bridge.
  registerValues(container, {
    invoicesBridge: {
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
      loadAssetImage: async (assetId) => {
        try {
          const a = await em().findOne(Asset, { id: assetId, deletedAt: null });
          if (!a || !a.mimeType.startsWith('image/')) return null;
          const adapter = await assetsLibrary.handle.adapters.getForBackend(
            a.storageBackend as 'local' | 's3' | 'gcs' | 'legacy',
          );
          // Legacy resolver only has resolveUrl — cannot stream bytes for PDF embed.
          if (!('open' in adapter) || typeof adapter.open !== 'function') return null;
          const stream = await adapter.open({ locator: a.storageLocator || a.storageUrl });
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          return { bytes: Buffer.concat(chunks), mimeType: a.mimeType };
        } catch {
          return null;
        }
      },
    } satisfies InvoicesBridge,
  });
  const invoicesCradle = container.cradle as unknown as InvoicesCradle;

  // Feature 059 — KSeF (Krajowy System e-Faktur). Consumes the invoices
  // domain events, submits FA(3) documents through a durable queue, and feeds
  // the KSeF number/QR back through the invoices port + PDF-renderer seam.
  // Feature 072 (T104) — `ksef` owns its services and routes now.
  registerValues(container, {
    ksefSellerNipResolver: async () => {
      try {
        const raw = await settings.settingsService.get('invoices.seller.tax_id', '00000000-0000-0000-0000-000000000000', z.string());
        const nip = raw.replace(/^PL/i, '').replace(/[\s-]/g, '');
        return nip.length > 0 ? nip : null;
      } catch {
        return null;
      }
    },
  });
  const ksefCradle = container.cradle as unknown as KsefCradle;
  // PDF QR seam (contracts/invoices-integration.md §3) — one resolver covers
  // every render path; absent/disabled module ⇒ pre-059 output.
  // Feature 072 (T113) — contributed, not set. `invoices` installs its own
  // resolver at construction and reads this per call, so a deployment without
  // KSeF simply has no verification block rather than an unset setter.
  registerValues(container, {
    ksefVerificationResolver: ksefCradle.ksef.handle.buildVerification,
  });

  // Feature 067 — Product Feed. Projects a sales channel's catalogue into
  // provider-shaped feed files published at a tokenised URL. Every cross-module
  // read is an injected collaborator (Principle I); channel membership goes
  // exclusively through the sanctioned accessor (Principle XII); artefact bytes
  // go through the Assets Library storage adapters WITHOUT creating `Asset`
  // rows (FR-043).
  //
  // Its own `CatalogQueryService` instance, for the same reason promotions has
  // one: it is the documented cross-module catalog port (Constitution I), and
  // sharing one instance between two unrelated consumers would make an
  // unrelated wiring change to one of them a silent change to the other.
  const catalogQueryServiceForProductFeeds = new CatalogQueryService(
    em,
    undefined,
    undefined,
    catalogAttributeReadService,
  );
  const productFeeds = productFeedsModule({
    emFactory: em,
    requireAdmin,
    commandBus,
    eventBus,
    storageAdapters: {
      getActive: () => assetsLibrary.handle.adapters.getActive(),
      getForBackend: async (backend) => {
        const adapter = await assetsLibrary.handle.adapters.getForBackend(backend);
        // `getForBackend` also answers the legacy resolver, which can only
        // build URLs. A feed artefact is always written by a real adapter, so
        // reaching this branch means the row is corrupt — fail loudly rather
        // than serving nothing.
        if (!('open' in adapter) || typeof adapter.open !== 'function') {
          throw new Error(
            `product_feeds: storage backend "${backend}" cannot stream artefact bytes.`,
          );
        }
        return adapter;
      },
    },
    salesChannelMembership: salesChannels.membershipService,
    pricingService: (container.cradle as unknown as PriceListsCradle).pricingService,
    taxService: taxesCradle.taxService,
    // Feature 070 — every secret a delivery target needs is stored through the
    // credentials module (FR-107); this module holds only the pointer.
    credentials: credentialsService,
    resolveAvailability: async (productIds, salesChannelId) => {
      const candidateWarehouseIds =
        await externalAvailabilityWarehouseChannels.resolveCandidateWarehouseIds(salesChannelId);
      return externalAvailabilityStockLevels.resolveAvailabilityBands(
        productIds,
        candidateWarehouseIds.length > 0 ? candidateWarehouseIds : undefined,
      );
    },
    // FR-025 — "category membership, including descendants" through the
    // documented catalog port, never a `product_categories` read from here.
    expandCategoryProductIds: (categoryIds) =>
      catalogQueryServiceForProductFeeds.expandCategoryProductIds(categoryIds),
    // FR-043 — only stable, PUBLIC URLs reach a feed file. A private asset is
    // absent from the map rather than present as an expiring signed URL, which
    // would survive token rotation and break as soon as it expired.
    resolvePublicImageUrls: async (assetIds) => {
      const out = new Map<string, string>();
      if (assetIds.length === 0) return out;
      const assets = await em().find(Asset, {
        id: { $in: assetIds },
        visibility: 'public',
        deletedAt: null,
      });
      const apiOrigin = (process.env['PUBLIC_API_BASE_URL'] ?? '').replace(/\/+$/, '');
      for (const asset of assets) {
        try {
          const resolved = await assetsLibrary.handle.service.resolveUrl(asset.id);
          if (resolved.expiresAt !== null) continue; // signed ⇒ not stable
          const url = /^https?:\/\//i.test(resolved.url)
            ? resolved.url
            : apiOrigin === ''
              ? null
              : `${apiOrigin}/${resolved.url.replace(/^\/+/, '')}`;
          if (url) out.set(asset.id, url);
        } catch {
          // An unresolvable asset is simply not an image for this feed.
        }
      }
      return out;
    },
    customFieldDefinitions: customFieldDefinitionService,
    languageService: languagesCradle.languageService,
    adminNotificationService: adminNotificationService,
    settings: settings.settingsService,
    // A feed URL exists to be pasted into Merchant Center, so a path-only one
    // is useless to the operator who copies it. `PUBLIC_API_BASE_URL` is the
    // deployment's answer; the local backend origin is the honest fallback,
    // because this is an API route on this process — not a storefront page.
    publicBaseUrl:
      process.env['PUBLIC_API_BASE_URL'] ??
      `http://localhost:${process.env['PORT'] ?? '3001'}`,
    tokenEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'],
    redis,
    // Principle X — the generation and reaper consumers run co-located unless
    // BACKEND_ROLE=api, in which case only the separate `pnpm worker` process
    // owns them.
    runWorkers,
  });
  modules.push(productFeeds.plugin);
  // FR-007 / FR-008 — install any missing predefined template. Non-destructive
  // (an existing `system_code` is left alone) and log-and-continue on failure,
  // the same posture as the `_i18n` bundle reconciler: a missing predefined
  // template is an inconvenience, an unbootable API is an outage.
  void productFeeds.handle.reconcileTemplates().catch((err: unknown) => {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'product_feeds predefined-template reconcile failed',
        error: String(err),
      }),
    );
  });
  // FR-077 / FR-078 / FR-086 — install any bundled taxonomy revision the
  // database does not have and re-evaluate mappings for staleness. **This path
  // reads files only and opens no socket**; a bundled revision becomes the one
  // in force only when the provider has none, so a platform upgrade never
  // activates a revision an operator did not choose. An installation with no
  // bundled data simply installs nothing.
  //
  // The other way a revision can arrive is the optional taxonomy check, which
  // ships **off** (`product_feeds.taxonomy_fetch_enabled` defaults to `false`):
  // its scheduler is asserted by `reconcileSchedules` below and exists only
  // while the setting is on, and a check it runs may only add an **inactive**
  // revision. Feed generation reads the revision in force from Postgres and
  // contacts nobody, however either arrived.
  void productFeeds.handle.reconcileTaxonomies().catch((err: unknown) => {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'product_feeds taxonomy reconcile failed',
        error: String(err),
      }),
    );
  });
  // FR-031 / research §R5.2 — Postgres is the source of truth for schedules and
  // Redis is a derived index. Re-asserting every per-feed Job Scheduler on each
  // worker boot is what makes a flushed Redis, an old snapshot, or a crash
  // between the Postgres commit and the Redis call cost at most one missed
  // tick instead of a feed that silently stops regenerating. Only the worker
  // role does it: an API-only process must not own schedules.
  if (runWorkers) {
    void productFeeds.handle.reconcileSchedules().catch((err: unknown) => {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'product_feeds schedule reconcile failed',
          error: String(err),
        }),
      );
    });
  }

  // Feature 068 — Ergonode PIM integration. A read-only inbound connector that
  // walks Ergonode's cursor-based change streams and keeps the catalogue in step
  // with them.
  //
  // Every catalogue write goes through catalog's own services, so an imported
  // product is audited, channel-bound and tenant-guarded by exactly the code an
  // administrator's edit runs through (Principle XIII). Those services are
  // constructed here rather than shared, for the same reason `product_feeds`
  // gets its own `CatalogQueryService`: they are this module's documented
  // cross-module ports (Principle I), and sharing one instance between two
  // unrelated consumers would make a wiring change to one a silent change to the
  // other.
  const pimErgonode = pimErgonodeModule({
    emFactory: em,
    requireAdmin,
    commandBus,
    eventBus,
    credentials: credentialsService,
    catalogAdmin: new CatalogAdminService(
      em,
      eventBus as unknown as CatalogEventBus,
      auditLogService,
      salesChannels.membershipService,
      commandBus,
      catalogAttributeReadService,
      customFieldDefinitionService,
    ),
    categoryAdmin: new CategoryAdminService(
      em,
      salesChannels.membershipService,
      commandBus,
      customFieldValueService,
    ),
    attributeSets: new AttributeSetService(em, commandBus, catalogAttributeReadService),
    gallery: new GalleryService(em, commandBus),
    attachments: new AttachmentService(em, commandBus),
    productLinks: new ProductLinkService(em, commandBus),
    grouped: new GroupedService(em, commandBus),
    assets: assetsLibrary.handle.service,
    priceLists: (container.cradle as unknown as PriceListsCradle).priceListService,
    currencies: currencyService,
    languageService: languagesCradle.languageService,
    adminNotificationService: adminNotificationService,
    settings: settings.settingsService,
    redis,
    // Principle X — the import and reaper consumers run co-located unless
    // BACKEND_ROLE=api, in which case only the separate `pnpm worker` process
    // owns them.
    runWorkers,
  });
  modules.push(pimErgonode.plugin);
  // FR-005 / research §B5 — Postgres is the source of truth for the import
  // schedule and Redis is a derived index. Re-asserting the connection's Job
  // Scheduler (and the module-wide stale-run sweep) on each worker boot is what
  // makes a flushed Redis, an old snapshot, or a crash between the Postgres
  // commit and the Redis call cost at most one missed tick instead of an
  // integration that silently stops importing. Only the worker role does it: an
  // API-only process must not own schedules. Log-and-continue, the same posture
  // as the reconcilers above — an unbootable API is worse than a drifted
  // schedule, which the next boot repairs anyway.
  if (runWorkers) {
    void pimErgonode.handle.reconcileSchedules().catch((err: unknown) => {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'pim_ergonode schedule reconcile failed',
          error: String(err),
        }),
      );
    });
  }

  // Feature 046 — Returns & Complaints (Refunds, RMA). Reads order facts only
  // through the OrderReturnContextPort (Principle I); settings drive the
  // free-return window and RMA prefix/suffix.
  // Feature 072 (T109) — `returns` owns its services and routes now. The
  // four settlement adapters and the actor resolvers stay here as one
  // bridge: each is a small adapter over `payments`, `invoices`,
  // `credit_limits` and `orders`, and a composition supplies all or none.
  registerValues(container, {
    returnsBridge: {
      resolveCustomerAccountId,
      resolveAdminUserId: (req) => adminContextResolver(req).adminUserId,
      orderContext: new OrderReturnContextProvider(em),
      paymentRefund: new PaymentRefundProvider(em),
      correctiveInvoice: new CorrectiveInvoiceProvider(em, invoicesCradle.invoiceNumberGenerator, auditLogService, eventBus),
      creditTopup: new CreditTopupProvider(creditLimitsCradle.creditLimitService),
      notifier: new ReturnEmailNotifier(
        platformMailer,
        async (customerAccountId) =>
          (await em().findOne(CustomerAccount, { id: customerAccountId }))?.email ?? null,
        {
          getTransactionalEmailSender: () => transactionalEmailSender,
          resolveLanguage: async (salesChannelId) =>
            (await em().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage ?? 'en-US',
        },
      ),
    } satisfies ReturnsBridge,
  });

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
  // Feature 072 (T124) — `shipments` owns the shipment-created notifier now and
  // subscribes through `ctx.subscribe`, so it stops when the module does. The
  // sender stays a contribution: `transactional_emails` announces it through a
  // callback this root holds, later than the module composes.
  registerValues(container, { shipmentEmailSender: () => transactionalEmailSender });
  // Feature 049 — Stripe payment gateway. Registers the Stripe PaymentAdapter
  // + gateway refund handler into the shared singletons, seeds one
  // payment_methods row per Stripe method, and mounts the webhook / storefront /
  // admin routes. Coupling (settings, sales channels, default channel) is
  // injected so the module stays isolated (Principle I).




  modules.push(
    transactionalEmailsModule({
      emFactory: em,
      settingsService: settings.settingsService,
      requireAdmin,
      resolveAdminUserId: (req) => adminContextResolver(req).adminUserId,
      manifests: resolvedRegistry.map((e) => e.manifest),
      mailer: platformMailer,
      auditLog: auditLogService,
      settingsAdmin: (container.cradle as unknown as SettingsCradle).settingsAdminService,
      resolveAssetUrl: async (assetId: string) => {
        try {
          const resolved = await assetsLibrary.handle.service.resolveUrl(assetId);
          return absolutizePublicUrl(resolved.url);
        } catch {
          return null;
        }
      },
      exposeSender: (sender) => {
        transactionalEmailSender = sender;
      },
      exposeBranding: (branding) => {
        emailBrandingService = branding;
      },
    }),
  );

  // Feature 048 — Newsletter. Own-infrastructure bulk email: subscriber
  // signup (per-channel opt-in), campaigns, automations, and a configurable
  // sending provider. Channel/mailer/settings coupling is injected here so the
  // module stays isolated (Principle I).
  // Feature 072 (T114) — `newsletter` owns its services and routes now.
  // These stay here because they are pinned per composition rather than
  // derived: the token secret and base URLs decide what an unsubscribe link
  // looks like, and the harness needs that predictable.
  registerValues(container, {
    newsletterBridge: {
      tokenSecret:
        process.env['NEWSLETTER_TOKEN_SECRET'] ??
        process.env['SESSION_COOKIE_SECRET'] ??
        'newsletter-dev-secret',
      platformChannelId:
        (await salesChannels.resolver.getSystemDefault())?.id ?? platformSettingsChannelId,
      resolveChannelIdByCode: async (code) =>
        (await salesChannels.resolver.getByCode(code))?.id ?? null,
      publicBaseUrl:
        process.env['PUBLIC_API_BASE_URL'] ??
        process.env['STOREFRONT_BASE_URL'] ??
        'http://localhost:3000',
      storefrontBaseUrl: process.env['STOREFRONT_BASE_URL'] ?? 'http://localhost:3000',
      loadCustomerEmail: async (customerAccountId) =>
        (await em().findOne(CustomerAccount, { id: customerAccountId }))?.email ?? null,
      mailer: platformMailer,
      emitEvent: (name, payload) =>
        eventBus.emit(name, {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          ...payload,
        }),
      resolveCustomerAccountId,
    } satisfies NewsletterBridge,
    // Contribution: campaign email carries this deployment's logo and accent,
    // announced by `transactional_emails` after it is built.
    newsletterEmailBranding: async (salesChannelId: string | null) => {
      if (!emailBrandingService) {
        return { logoUrl: '', accentColor: '#1f2937' };
      }
      const branding = await emailBrandingService.resolve(salesChannelId);
      return { logoUrl: branding.logoUrl, accentColor: branding.accentColor };
    },
  });

  // Feature 049 — Google Analytics. GA4 integration: per-channel activation +
  // Measurement ID, Enhanced Ecommerce, custom events, and server-side tagging.
  // Config lives in the Settings module; server-side delivery is queue-backed.

  // Feature 063 — LinkedIn Ads. Per-channel Insight Tag + conversion mappings.
  // Config lives in the Settings module; the access token is a `secret` setting.

  // Feature 064 — Meta Ads. Per-channel Meta Pixel + custom event mappings.

  // Feature 066 — Google Tag Manager. Settings-only module: per-channel
  // container injection plus the optional server-side tagging relay. It owns
  // no table and no admin page, so no EntityManager and no requireAdmin here.

  // Shopping lists / quick order — depends on the RFQ service built above
  // so the "convert to RFQ" flow goes through the new createForCustomer API.
  modules.push(
    shoppingListsModule({
      emFactory: em,
      rfqService: quoteRequests.handle().rfqService,
      catalogAttributeRead: catalogAttributeReadService,
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
      settingsService: settings.settingsService,
      requireAdmin,
      auditLog: auditLogService,
      organizationRestriction: organizationRestrictionService,
      resolveAdminContext: adminContextResolver,
      // Feature 039 — one-click buy: lazy OrderService + the enabled setting.
      getOrderService: () => orderServiceForOneClick,
      resolveOneClickEnabled: async (salesChannelId) => {
        try {
          const { z } = await import('zod');
          return await settings.settingsService.get(
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
  // Feature 072 (T089) — `_i18n` owns its service, its reconciler and its
  // routes now. The root only reads the two the platform consumes.
  const adminI18nCradle = container.cradle as unknown as AdminI18nCradle;

  // Feature 020 — Admin Command Palette actions registry. Built before
  // the lifecycle so its reconciler can be plugged into the orchestrator
  // at construction time.
  // Feature 072 (T099) — `admin_actions` owns its service, its reconcile and
  // its routes now. The operator presence axis stays a root's to supply:
  // which modules a deployment ships is not this module's business.
  registerValues(container, {
    moduleActivationProbe: (moduleId: string) =>
      effectiveState.presence(moduleId)?.operatorActivated ?? true,
  });
  const adminActionsCradle = container.cradle as unknown as AdminActionsCradle;

  const lifecycle = lifecycleModuleFromStaticEntries(
    {
      orm,
      redis,
      redisSubscriber,
      emFactory: em,
      auditLog: auditLogService,
      // Feature 019: hand the i18n reconciler to the orchestrator so
      // module:install and module:uninstall --hard keep
      // translation_bundles aligned with the lifecycle.
      i18nReconciler: adminI18nCradle.adminI18nReconciler,
      // Feature 020: hand the admin-actions reconciler to the
      // orchestrator so module:install and module:uninstall --hard keep
      // module_actions aligned with the lifecycle.
      adminActionsReconciler: adminActionsCradle.adminActionsReconciler,
    },
    resolvedRegistry.map((e) => ({
      manifest: e.manifest,
      filePath: e.filePath,
      ...(e.installHook ? { installHook: e.installHook } : {}),
      ...(e.uninstallHook ? { uninstallHook: e.uninstallHook } : {}),
    })),
  );
  lifecycleRef = lifecycle;
  // Feature 072 (T125) — `_lifecycle` registers its own routes now, through
  // `ctx.ungatedRoutes`. Two names stay a composition's, and both genuinely
  // differ: this deployment boots an orchestrator (the harness does not, because
  // it never populates `module_registrations`), and a committed flip propagates
  // by refreshing from the database and dropping the storefront's cache.
  registerValues(container, {
    lifecycleOrchestrator: lifecycle.handle.orchestrator,
    lifecycleActivationPropagation: {
      commandBus,
      propagation: {
        // The writing process refreshes itself rather than waiting on its own
        // pub/sub round trip, so the very next request it serves sees the
        // new state.
        refreshLocalState: () => registryCache.refreshFromDb(em),
        publishStateChanged: (payload: Parameters<typeof publishStateChanged>[1]) =>
          publishStateChanged(redis, payload),
        revalidateStorefront: (tags: string[]) =>
          new StorefrontRevalidator({
            baseUrl: process.env['STOREFRONT_BASE_URL'],
            secret: process.env['REVALIDATE_SECRET'],
          }).revalidate(tags),
      },
    },
  });
  // Feature 072 (T089) — the accessor `_i18n` walks to reconcile every module's
  // translation bundles. It stays an accessor rather than the registry itself
  // because of the order this file is written in: `_i18n` composes with the
  // late pass ~1100 lines above, and the registry it needs does not exist until
  // the line above this one. `_i18n` resolves it at plugin-attach time, which
  // is after this function returns. Goes when `_lifecycle` converts.
  registerValues(container, {
    lifecycleManifestRegistry: () => lifecycleRef?.handle.registry,
  });

  permissionCatalogueService.setEnabledModuleIdsAccessor(() => registryCache.enabledIds());
  redisSubscriber.on('message', (channel) => {
    if (channel === STATE_CHANGED_CHANNEL) {
      permissionCatalogueService.invalidate();
    }
  });

  // The boot half only: reconciling first-boot registrations, warming the
  // registry cache and resuming workers. Its routes are the module's own now.
  modules.push(lifecycle.plugin);

  // Feature 043 — prompt assistant for the admin command palette. The module
  // owns the registry port; catalog/inventory contribute their tool handlers
  // here (adapter-registry pattern — Principle I).
  const catalogToolDeps = {
    emFactory: em,
    events: eventBus,
    auditLogService,
    salesChannelMembership: salesChannels.membershipService,
    redis,
  };
  // Feature 072 — the module composed itself in the late pass; what is left
  // here is the one thing a module cannot do for itself: hand it the
  // contributions of whichever modules this deployment happens to ship.
  registerValues(container, {
    promptActionsBulkProgressResolver: catalogBulkProgressResolver(catalogToolDeps),
  });
  const promptActionToolRegistry = (
    container.cradle as unknown as { promptActionToolRegistry: PromptActionToolRegistry }
  ).promptActionToolRegistry;
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
    promptActionToolRegistry.register(tool);
  }

  // Feature 004 / T024 — Boot-time manifest reconciliation. Walks every
  // module's settings manifest and inserts any missing groups/settings
  // idempotently before the HTTP layer starts serving requests. NEVER deletes
  // (R-1); destructive uninstall is CLI-only.
  // Derived from the module registry, not hand-listed: a module that declared
  // `settings:` but was forgotten in a literal array never got its rows, so
  // /settings silently omitted it (see collectRegisteredSettingsManifests).
  // linkedin_ads / meta_ads / tpay / payu / cms need no entry here — registering
  // their manifests is enough.
  const settingsManifests: ModuleSettingsManifest[] =
    collectRegisteredSettingsManifests();
  const reconcilerEm = em();
  const reconciler = new ManifestReconciler(reconcilerEm);
  const reconciliation = await enterSystemScope(
    'boot: reconcile module settings manifests',
    () => reconciler.apply(settingsManifests),
    { entryPoint: 'boot' },
  );
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

  // Feature 057 — mount the active deployment's client-only overlay modules.
  // Empty for a bare-core build, so `modules` is unchanged there.
  const overlayModulePlugins = await loadOverlayModulePlugins({
    emFactory: em,
    redis,
    eventBus,
    commandBus,
    auditLogService,
    requireAdmin,
    apiInterceptors,
  });
  for (const plugin of overlayModulePlugins) modules.push(plugin);

  return {
    orm,
    redis,
    modules,
    commandBus,
    apiInterceptors,
    errorEnvelope: {
      resolvePreferredLanguage: async (request) => {
        if (request.actor.kind !== 'admin') return null;
        const adminUser = await em().findOne(AdminUser, { id: request.actor.adminUserId });
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
    dispose: async () => {
      // Feature 062 — drain the webhook delivery pipeline before dropping the
      // Redis connections (graceful shutdown). Unbridging and closing the queue
      // are the container's job since T098: `ctx.subscribe` unsubscribes with
      // the module and the queue registration carries its own disposer.
      if (webhookWorker) await webhookWorker.close().catch(() => undefined);
      redis.disconnect();
      redisSubscriber.disconnect();
      await closeOrm();
    },
  };
}
