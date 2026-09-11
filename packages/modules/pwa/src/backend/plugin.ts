import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type { Queue, Worker } from 'bullmq';
import { z } from 'zod';
import type {
  CustomerAccountReadPort,
  CustomerGroupReadPort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import { PwaConfigResolver, type SettingsReadPort } from './services/pwa-config-resolver.js';
import { PwaIconService, type AssetUploadPort } from './services/pwa-icon-service.js';
import { PushSubscriptionService } from './services/push-subscription-service.js';
import { PushMessageService } from './services/push-message-service.js';
import { PushProviderRegistry } from './services/push-provider-registry.js';
import { WebPushProvider } from './services/providers/web-push-provider.js';
import {
  createPushEventHandlers,
  type PushEventLogger,
  type PushEventTarget,
} from './services/push-event-subscriber.js';
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
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

const BoolSchema = z.boolean();

export interface PwaModuleOptions {
  emFactory: () => EntityManager;
  redis: Redis;
  /** Principle X dial — start the push-delivery consumer co-located (true) or only in the worker process. */
  runWorkers: boolean;
  settings: SettingsReadPort & { get<T>(code: string, channelId: string, schema: z.ZodType<T>): Promise<T> };
  settingsWrite: SettingsWritePort;
  requireAdmin: RequireAdminFactory;
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
   * The FR-024 order-status auto-trigger, and **required** since T118c.
   *
   * It was optional while a composition root had to supply it, on the reasoning
   * that a deployment which pushes on no order event has nothing to give. This
   * module resolves `orderReadPort` itself now and declares the edge, so the
   * absent branch is one no composition can reach — and an option nothing can
   * omit that is nonetheless typed as omittable is a branch no test can drive.
   */
  resolveOrderTarget: (payload: {
    orderId: string;
    salesChannelId: string;
    from: string;
    to: string;
  }) => Promise<PushEventTarget | null>;
  /**
   * The quote-request auto-trigger, and it stays optional because **nothing
   * supplies it**.
   *
   * Measured on the tree T118c drained: `resolveQuoteTarget` appears in this
   * file, in `push-event-subscriber.ts`, in the barrel's `PwaBridge` — and in
   * neither composition root. So `onQuoteRequestUpdated` has returned at its
   * first line on every deployment since the option was written, the handler is
   * registered, the subscription is gated, and the push it exists to send has
   * never been sent by anybody.
   *
   * It is left optional rather than deleted or implemented: implementing it is a
   * design act (a `quote_requests` read port this module does not declare, and a
   * second sentence to compose), and deleting it would erase the only record
   * that the feature was specified. The gap is in T118c's own report.
   */
  resolveQuoteTarget?: (payload: {
    quoteRequestId: string;
    sourceEventId: string;
  }) => Promise<PushEventTarget | null>;
}

export interface PwaModuleHandle {
  /** The FR-024 auto-trigger handlers; `backend.ts` owns their registration. */
  pushEventHandlers: ReturnType<typeof createPushEventHandlers>;
  configResolver: PwaConfigResolver;
  iconService: PwaIconService;
  subscriptionService: PushSubscriptionService;
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
  const configResolver = new PwaConfigResolver(options.settings, options.emFactory);
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

  // Auto-triggered push (FR-024) — producer only; enqueues, never sends inline.
  // `backend.ts` registers these two through `ctx.subscribe`, so they stop with
  // the module (issue #107).
  const pushEventHandlers = createPushEventHandlers({
    messageService,
    log: () => eventLogger,
    resolveOrderTarget: options.resolveOrderTarget,
    ...(options.resolveQuoteTarget ? { resolveQuoteTarget: options.resolveQuoteTarget } : {}),
    isPushEnabled: async (salesChannelId) => {
      try {
        return await options.settings.get('pwa.push_enabled', salesChannelId, BoolSchema);
      } catch {
        return false;
      }
    },
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
    configResolver,
    iconService,
    subscriptionService,
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
