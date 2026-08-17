import type { Queue, Worker } from 'bullmq';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import { lazyPort, type ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { registerWebhooksAdminRoutes } from './routes.js';
import { bridgeEventHandler } from './services/event-bridge.js';
import { WebhookService } from './services/webhook-service.js';
import {
  createWebhookQueue,
  createWebhookWorker,
  type WebhookJobData,
} from './services/webhook-queue.js';
import { createDeliveryProcessor } from './services/webhook-delivery-worker.js';

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
 *
 * **The delivery consumer came home in T143a cluster 6.** T098 left it in
 * `composition.ts` on the grounds that "whether workers run at all is a
 * deployment decision" — true of the *flag*, and not of the worker. Built by a
 * root it was the one part of this module no lifecycle seam covered: the
 * bridge stopped enqueuing when the module went off, while the consumer kept
 * draining whatever was already on the queue and kept writing
 * `webhook_deliveries` rows. `ctx.worker` puts it behind `defineModuleWorker`,
 * which pauses it with the module and resumes it with it. The deployment half
 * stays a root's, as `webhooksRunWorkers` — the same shape `searchRunWorkers`
 * and `productFeedsRunWorkers` already have, and for the same reason: the
 * harness runs no consumer, and deriving that from `BACKEND_ROLE` here would
 * start one in every test file.
 */

/** The events bridged to the delivery queue (contracts/order-webhooks.md §2). */
export const BRIDGED_EVENT_TYPES = ['order.created.v1', 'order.status_changed.v1'] as const;

export interface WebhooksCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly redis: import('ioredis').Redis;
  /**
   * Whether this composition runs the delivery consumer (Principle X).
   * Root-supplied: production follows `BACKEND_ROLE`, the harness runs none.
   */
  readonly webhooksRunWorkers: boolean;
  readonly webhookService: WebhookService;
  readonly webhookQueue: Queue<WebhookJobData>;
  readonly webhookDeliveryWorker: Worker<WebhookJobData>;
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

    /**
     * The delivery consumer: HMAC signing, retries and the
     * `webhook_deliveries` bookkeeping (T143a).
     *
     * A registration rather than a `new` inside the route body, so it carries
     * a **disposer** exactly as the queue does — a composition that disposes
     * its container drains the worker before the Redis sockets go, which is
     * what the graceful shutdown in `composition.ts` used to spell by hand.
     * Nothing resolves it unless `webhooksRunWorkers` is true, and a
     * registration nobody resolves is never constructed, so a composition that
     * runs no consumer pays nothing for this.
     */
    webhookDeliveryWorker: ctx
      .asFunction(({ redis }: WebhooksCradle) =>
        createWebhookWorker(
          redis,
          createDeliveryProcessor({
            // Read per call rather than captured: `webhookService` is this
            // module's own gated port, and a job draining mid-flight must
            // still meet the gate.
            recordDelivery: async (input) => {
              await ctx.cradle<WebhooksCradle>().webhookService.recordDelivery(input);
            },
          }),
        ),
      )
      .singleton()
      .disposer((worker: Worker<WebhookJobData>) => worker.close().catch(() => undefined)),
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
    const { requireAdmin, webhooksRunWorkers } = ctx.cradle<WebhooksCradle>();

    // `ctx.worker` wraps it in `defineModuleWorker`, so it starts paused when
    // the module is off and the orchestrator pauses and resumes it as the
    // operator flips the module. Attached here rather than at registration
    // because that is where `app.log` exists — the same place
    // `google_analytics` attaches its delivery consumer.
    if (webhooksRunWorkers) {
      ctx.worker(ctx.cradle<WebhooksCradle>().webhookDeliveryWorker, { logger: app.log });
    }

    await registerWebhooksAdminRoutes(app, {
      // Lazily, even though the module owns this port: route *registration* runs
      // inside `buildServer` whatever the module's effective state is, so
      // destructuring the gate here would stop the next start instead of
      // stopping the routes (D-40).
      webhookService: lazyPort<WebhookService>(ctx, 'webhookService'),
      requireAdmin,
    });
  });
}
