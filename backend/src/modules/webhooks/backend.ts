import type { Queue } from 'bullmq';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { Webhook } from './entities/webhook.entity.js';
import { WebhookDelivery } from './entities/webhook-delivery.entity.js';
import { registerWebhooksAdminRoutes } from './routes.js';
import { bridgeEventHandler } from './services/event-bridge.js';
import { WebhookService } from './services/webhook-service.js';
import { createWebhookQueue, type WebhookJobData } from './services/webhook-queue.js';

/**
 * `webhooks` — the module whose subscriptions are rows, not registrations
 * (feature 072, wave 1, T098).
 *
 * `api_keys/plugin.ts` built the `WebhookService` and mounted the admin routes;
 * `composition.ts` created the queue, wired the EventBus bridge and started the
 * delivery worker. Three files for one module, none of them its own.
 *
 * **The gating question this module poses is the interesting part.** A webhook
 * subscription is a database row an operator creates at runtime, so there is no
 * registration seam per subscription to wrap — the obvious reading of
 * Constitution XVII ("gate every subscription") has nothing to attach to. But
 * the module owns exactly **two** EventBus subscriptions, one per bridged event
 * type, and every delivery in the platform passes through them. Gating the
 * bridge stops all of it at one seam, and does so without consulting the
 * database: while the module is off, the subscription lookup is never reached,
 * so no row is read and no job is enqueued.
 *
 * That also gives the right off-state semantics. Switching `webhooks` off is
 * not uninstalling: the subscriptions stay in the table, deliveries already
 * recorded stay in `webhook_deliveries`, and switching it back on resumes
 * bridging without the operator re-creating anything. Events emitted while it
 * was off are simply not delivered, which is what "behaves as if never
 * installed" means for a module whose job is to react to events.
 */

export const entities = [Webhook, WebhookDelivery];

/** The events bridged to the delivery queue (contracts/order-webhooks.md §2). */
export const BRIDGED_EVENT_TYPES = ['order.created.v1', 'order.status_changed.v1'] as const;

export interface WebhooksCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly redis: import('ioredis').Redis;
  readonly webhookService: WebhookService;
  readonly webhookQueue: Queue<WebhookJobData>;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort(
    'webhookService',
    ctx
      .asFunction(
        ({ emFactory, auditLogService }: WebhooksCradle) =>
          new WebhookService(emFactory, auditLogService),
      )
      .singleton(),
  );

  ctx.di.register({
    webhookQueue: ctx
      .asFunction(({ redis }: WebhooksCradle) => createWebhookQueue(redis))
      .singleton()
      .disposer((queue: Queue<WebhookJobData>) => queue.close().catch(() => undefined)),
  });

  for (const eventType of BRIDGED_EVENT_TYPES) {
    // One `ctx.subscribe` per bridged type. The kernel's wrapper is what makes
    // the module's effective state decide whether the handler runs at all, so
    // the lookup below is never reached while the module is off.
    ctx.subscribe(eventType, (payload) => {
      const { webhookQueue, webhookService } = ctx.cradle<WebhooksCradle>();
      return bridgeEventHandler(eventType, {
        queue: webhookQueue,
        subscriptionLookup: webhookService,
      })(payload);
    });
  }

  ctx.routes(async (app) => {
    const { webhookService, requireAdmin } = ctx.cradle<WebhooksCradle>();
    await registerWebhooksAdminRoutes(app, { webhookService, requireAdmin });
  });
}
