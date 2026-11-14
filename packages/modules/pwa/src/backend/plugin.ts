import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type { Queue, Worker } from 'bullmq';
import { z } from 'zod';
import type {
  AdminI18nTranslatePort,
  CustomerAccountReadPort,
  CustomerGroupReadPort,
  OrderReadPort,
  OrganizationDetailsPort,
  CustomerPushPort,
} from '@endora-commerce/contracts';
import { PwaConfigResolver, type SettingsReadPort } from './services/pwa-config-resolver.js';
import { PwaIconService, type AssetUploadPort } from './services/pwa-icon-service.js';
import { PushSubscriptionService } from './services/push-subscription-service.js';
import { PushPreferenceService } from './services/push-preference-service.js';
import { PushMessageService } from './services/push-message-service.js';
import { PushProviderRegistry } from './services/push-provider-registry.js';
import { WebPushProvider } from './services/providers/web-push-provider.js';
import {
  createPushEventHandlers,
  type PushEventLogger,
} from './services/push-event-subscriber.js';
import { createStatusPushComposer } from './services/status-push-composer.js';
import { createCustomerPushPort } from './services/customer-push-port.js';
import {
  createPushDeliveryQueue,
  createPushDeliveryWorker,
  type PushDeliveryJobData,
} from './services/push-delivery-queue.js';
import { makePushDeliveryProcessor } from './workers/push-delivery-worker.js';
import {
  registerPwaStorefrontRoutes,
} from './routes.storefront.js';
import {
  registerPwaAdminRoutes,
  type AdminAuditContext,
  type SettingsWritePort,
} from './routes.admin.js';
import {
  effectiveState,
  enterSystemScope,
  type RequireAdminFactory,
  type RequireCustomerGuard,
  type SalesChannelResolutionPort,
} from '@endora-commerce/platform/kernel';
import type { CommandBus } from '@endora-commerce/platform/commands';

const BoolSchema = z.boolean();

export interface PwaModuleOptions {
  emFactory: () => EntityManager;
  redis: Redis;
  /** Principle X dial — start the push-delivery consumer co-located (true) or only in the worker process. */
  runWorkers: boolean;
  settings: SettingsReadPort & { get<T>(code: string, channelId: string, schema: z.ZodType<T>): Promise<T> };
  settingsWrite: SettingsWritePort;
  requireAdmin: RequireAdminFactory;
  /** `auth`'s storefront guard, for the customer preference routes. */
  requireCustomer: RequireCustomerGuard;
  /**
   * The platform's Command Bus: the customer preference write is an audited
   * Command (`specs/149-pwa-order-status-push/` research R-12).
   */
  commandBus: Pick<CommandBus, 'run'>;
  /**
   * The three rows this module reads out of other modules (feature 075,
   * Phase C). Resolved as gated ports in `backend.ts`, never captured, so a
   * switched-off owner refuses at the call and not at composition time.
   */
  customerAccounts: CustomerAccountReadPort;
  organizationDetails: OrganizationDetailsPort;
  customerGroups: CustomerGroupReadPort;
  /**
   * The upload half of `assets_library`' published `assetsLibraryPort`, narrowed
   * to the one method the icon pipeline calls
   * (`specs/110-instance-repository/` T118c). `backend/index.ts` resolves the
   * whole port; this names the demand.
   */
  assetUpload: AssetUploadPort;
  resolveAssetUrl: (assetId: string) => Promise<string | null>;
  /**
   * `null` = this deployment has no channel to read for, so `pwa` resolves its
   * configuration platform-wide (feature 072, D-41). It used to fall back to the
   * root's `'default'` sentinel — a channel *code* against a `uuid` column.
   *
   * `resolveChannelIdByCode` stood beside these two until T118c and was called
   * by nothing; see the note in `routes.storefront.ts`.
   */
  defaultChannelId: () => Promise<string | null>;
  channelCodeForId: (channelId: string) => Promise<string | null>;
  resolveAuditContext: (request: FastifyRequest) => AdminAuditContext;
  /** mailto: subject for VAPID. */
  vapidSubject: string;
  /**
   * The module's logger, as the composition can supply it — `ctx.log`. It is
   * the fallback rather than the destination: the FR-024 handlers upgrade to
   * the application's own logger as soon as this module's routes register, and
   * only the window before that (where no event can reach them anyway) lands
   * here.
   */
  log: PushEventLogger;
  /**
   * What the automatic order status push reads (`specs/149-pwa-order-status-push/`),
   * each a published port `backend/index.ts` resolves as a `lazyPort`:
   * the order and its status label, the channel the order belongs to, and
   * `_i18n`'s translation of this module's own bundle. The channel port also
   * answers `customerPushPort`'s system default channel.
   *
   * It replaces the two root-shaped target resolvers this option set used to
   * carry (research R-1). The quote push's read of `quoteRequestReadPort` went
   * with `specs/179-rfq-and-customer-notifications/` WP-10: `quote_requests`
   * now pushes through `customerPushPort` with the sentence already rendered.
   */
  statusPush: {
    orders: Pick<OrderReadPort, 'findById' | 'findStatusDefinition'>;
    channels: Pick<SalesChannelResolutionPort, 'getById' | 'getSystemDefault'>;
    translate: Pick<AdminI18nTranslatePort, 'translate'>;
  };
}

export interface PwaModuleHandle {
  /** The FR-024 auto-trigger handlers; `backend.ts` owns their registration. */
  pushEventHandlers: ReturnType<typeof createPushEventHandlers>;
  /**
   * The published `customerPushPort` (`specs/179-rfq-and-customer-notifications/`
   * FR-060); `backend/index.ts` provides it, gated on this module's presence.
   */
  customerPushPort: CustomerPushPort;
  configResolver: PwaConfigResolver;
  iconService: PwaIconService;
  subscriptionService: PushSubscriptionService;
  preferenceService: PushPreferenceService;
  messageService: PushMessageService;
  providerRegistry: PushProviderRegistry;
  deliveryQueue: Queue<PushDeliveryJobData>;
}

export interface PwaModuleResult {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: PwaModuleHandle;
  /**
   * The push-delivery consumer, for `backend.ts` to hand to `ctx.worker` — the
   * shape `ksef` and `catalog` use. Empty when `runWorkers` is false.
   */
  workers: Worker<PushDeliveryJobData>[];
}

export function pwaModule(options: PwaModuleOptions): PwaModuleResult {
  const configResolver = new PwaConfigResolver(options.settings, options.emFactory, () =>
    effectiveState.isPresent('quote_requests'),
  );
  const iconService = new PwaIconService(options.emFactory, options.assetUpload);
  // Feature 087 Group B / D-187 — the subscription registry stamps the
  // organisation an owned device belongs to, derived from the owning account
  // through the gated port this module already resolves. Passed rather than
  // optional: `push_subscriptions_organization_attribution_chk` refuses a row
  // this service could not attribute, so a composition with no way to answer
  // the question cannot write the table at all.
  const subscriptionService = new PushSubscriptionService(
    options.emFactory,
    options.customerAccounts,
  );

  const providerRegistry = new PushProviderRegistry();
  providerRegistry.register(new WebPushProvider(options.settings, options.vapidSubject));

  const deliveryQueue = createPushDeliveryQueue(options.redis);
  const messageService = new PushMessageService(
    options.emFactory,
    deliveryQueue,
    options.customerAccounts,
    options.organizationDetails,
  );

  // Where the two auto-triggers write a skipped or failed push. Composition
  // runs before `buildServer`, so `options.log` is the best a root can offer at
  // construction time; `app.log` is the log the platform actually collects, and
  // the plugin below moves the holder onto it. Nothing can emit an in-process
  // event before that plugin has run, so the fallback is a type obligation
  // rather than a path.
  let eventLogger: PushEventLogger = options.log;

  // The customer's account-wide choice; an account with no row wants both.
  const preferenceService = new PushPreferenceService(
    options.emFactory,
    options.customerAccounts,
    options.commandBus,
  );

  // Automatic status pushes — producer only; enqueues, never sends inline.
  // `backend/index.ts` registers the handlers through `ctx.subscribe`, so they
  // stop with the module (issue #107).
  const isSettingOn = async (code: string, salesChannelId: string): Promise<boolean> => {
    try {
      return await options.settings.get(code, salesChannelId, BoolSchema);
    } catch {
      return false;
    }
  };
  const statusPushComposer = createStatusPushComposer({
    orders: options.statusPush.orders,
    customerAccounts: options.customerAccounts,
    channels: options.statusPush.channels,
    isSettingOn,
    preferences: preferenceService,
    translate: options.statusPush.translate,
    messageService,
    runInSystemScope: (reason, run) => enterSystemScope(reason, run),
    log: () => eventLogger,
  });
  const pushEventHandlers = createPushEventHandlers({
    composer: statusPushComposer,
    log: () => eventLogger,
  });

  // `specs/179-rfq-and-customer-notifications/` FR-060 — another module's push
  // to one account, under the composer's gates plus a device check. Producer
  // only, like the composer.
  const customerPushPort = createCustomerPushPort({
    channels: options.statusPush.channels,
    isSettingOn,
    customerAccounts: options.customerAccounts,
    preferences: preferenceService,
    hasActiveSubscription: (customerAccountId, salesChannelId) =>
      subscriptionService.hasActive(customerAccountId, salesChannelId),
    messageService,
    runInSystemScope: (reason, run) => enterSystemScope(reason, run),
  });

  // Push-delivery consumer (Principle X). Separable entrypoint; co-located by
  // default given low push volume, split-out-able under load via BACKEND_ROLE.
  //
  // It is **handed to `backend.ts`** rather than started here, and that is the
  // Constitution XVII repair rather than tidiness: this line used to read
  // `createPushDeliveryWorker(options.redis, processor);`, the value dropped on
  // the floor. A worker outside `ctx.worker` is in no per-module registry, so
  // `pauseWorkersFor('pwa')` reached nothing and the presence reconcile had
  // nothing to reconcile — an operator who switched `pwa` off went on having
  // push notifications delivered to their customers' devices, on both axes,
  // while the module's own admin and storefront surfaces refused. That is what
  // made it invisible, and it is the same shape issue #107 found for
  // subscribers; `check:subscribe-seam` now refuses it.
  const workers = options.runWorkers
    ? [
        createPushDeliveryWorker(
          options.redis,
          makePushDeliveryProcessor({
            emFactory: options.emFactory,
            registry: providerRegistry,
          }),
        ),
      ]
    : [];

  const handle: PwaModuleHandle = {
    pushEventHandlers,
    customerPushPort,
    configResolver,
    iconService,
    subscriptionService,
    preferenceService,
    messageService,
    providerRegistry,
    deliveryQueue,
  };

  const plugin = async (app: FastifyInstance): Promise<void> => {
    eventLogger = app.log;
    await registerPwaStorefrontRoutes(app, {
      configResolver,
      iconService,
      subscriptionService,
      resolveAssetUrl: options.resolveAssetUrl,
      preferenceService,
      requireCustomer: options.requireCustomer,
    });
    await registerPwaAdminRoutes(app, {
      requireAdmin: options.requireAdmin,
      emFactory: options.emFactory,
      configResolver,
      iconService,
      subscriptionService,
      messageService,
      settingsWrite: options.settingsWrite,
      customerAccounts: options.customerAccounts,
      organizationDetails: options.organizationDetails,
      customerGroups: options.customerGroups,
      settingsRead: options.settings,
      resolveScopeChannelId: async (salesChannelId) =>
        salesChannelId ?? (await options.defaultChannelId()),
      channelCodeForId: options.channelCodeForId,
      resolveAuditContext: options.resolveAuditContext,
    });
  };

  return { plugin, handle, workers };
}
