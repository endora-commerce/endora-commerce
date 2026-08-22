import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { Queue } from 'bullmq';
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
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

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
  /** assets_library upload facade. */
  assetUpload: AssetUploadPort;
  resolveAssetUrl: (assetId: string) => Promise<string | null>;
  /** Channel helpers (composition owns the sales_channels coupling). */
  /**
   * `null` = this deployment has no channel to read for, so `pwa` resolves its
   * configuration platform-wide (feature 072, D-41). Both used to fall back to
   * the root's `'default'` sentinel — a channel *code* against a `uuid` column.
   */
  resolveChannelIdByCode: (code: string | undefined) => Promise<string | null>;
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
  resolveCustomerAccountId?: (request: FastifyRequest) => Promise<string | null>;
  resolveOrderTarget?: (payload: {
    orderId: string;
    salesChannelId: string;
    from: string;
    to: string;
  }) => Promise<PushEventTarget | null>;
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
}

export function pwaModule(options: PwaModuleOptions): PwaModuleResult {
  const configResolver = new PwaConfigResolver(options.settings, options.emFactory);
  const iconService = new PwaIconService(options.emFactory, options.assetUpload);
  const subscriptionService = new PushSubscriptionService(options.emFactory);

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
    ...(options.resolveOrderTarget ? { resolveOrderTarget: options.resolveOrderTarget } : {}),
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
  if (options.runWorkers) {
    const processor = makePushDeliveryProcessor({
      emFactory: options.emFactory,
      registry: providerRegistry,
    });
    createPushDeliveryWorker(options.redis, processor);
  }

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
      resolveChannelId: options.resolveChannelIdByCode,
      resolveAssetUrl: options.resolveAssetUrl,
      ...(options.resolveCustomerAccountId
        ? { resolveCustomerAccountId: options.resolveCustomerAccountId }
        : {}),
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

  return { plugin, handle };
}
