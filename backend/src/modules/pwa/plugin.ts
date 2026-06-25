import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { Queue } from 'bullmq';
import { z } from 'zod';
import type { EventBus } from '../../events/bus.js';
import { PwaConfigResolver, type SettingsReadPort } from './services/pwa-config-resolver.js';
import { PwaIconService, type AssetUploadPort } from './services/pwa-icon-service.js';
import { PushSubscriptionService } from './services/push-subscription-service.js';
import { PushMessageService } from './services/push-message-service.js';
import { PushProviderRegistry } from './services/push-provider-registry.js';
import { WebPushProvider } from './services/providers/web-push-provider.js';
import { setupPushEventSubscriber, type PushEventTarget } from './services/push-event-subscriber.js';
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
  type RequireAdminFactory,
  type SettingsWritePort,
} from './routes.admin.js';

const BoolSchema = z.boolean();

export interface PwaModuleOptions {
  emFactory: () => EntityManager;
  redis: Redis;
  /** Principle X dial — start the push-delivery consumer co-located (true) or only in the worker process. */
  runWorkers: boolean;
  settings: SettingsReadPort & { get<T>(code: string, channelId: string, schema: z.ZodType<T>): Promise<T> };
  settingsWrite: SettingsWritePort;
  requireAdmin: RequireAdminFactory;
  eventBus: EventBus;
  /** assets_library upload facade. */
  assetUpload: AssetUploadPort;
  resolveAssetUrl: (assetId: string) => Promise<string | null>;
  /** Channel helpers (composition owns the sales_channels coupling). */
  resolveChannelIdByCode: (code: string | undefined) => Promise<string>;
  defaultChannelId: () => Promise<string>;
  channelCodeForId: (channelId: string) => Promise<string | null>;
  resolveAuditContext: (request: FastifyRequest) => AdminAuditContext;
  /** mailto: subject for VAPID. */
  vapidSubject: string;
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
  const messageService = new PushMessageService(options.emFactory, deliveryQueue);

  // Auto-triggered push (FR-024) — producer only; enqueues, never sends inline.
  setupPushEventSubscriber({
    eventBus: options.eventBus,
    messageService,
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
    configResolver,
    iconService,
    subscriptionService,
    messageService,
    providerRegistry,
    deliveryQueue,
  };

  const plugin = async (app: FastifyInstance): Promise<void> => {
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
      configResolver,
      iconService,
      subscriptionService,
      messageService,
      settingsWrite: options.settingsWrite,
      settingsRead: options.settings,
      resolveScopeChannelId: async (salesChannelId) =>
        salesChannelId ?? (await options.defaultChannelId()),
      channelCodeForId: options.channelCodeForId,
      resolveAuditContext: options.resolveAuditContext,
    });
  };

  return { plugin, handle };
}
