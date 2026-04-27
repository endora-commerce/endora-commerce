import { randomUUID } from 'crypto';
import type { Queue } from 'bullmq';
import type { EventBus, EventBase } from '../../../events/bus.js';
import type { WebhookJobData } from './webhook-queue.js';

/**
 * Bridges the in-process event bus (R-17) to the durable webhook queue (R-13).
 *
 * On each emitted domain event:
 *   1. Look up active Webhook subscriptions that match the event type.
 *   2. For every subscriber, enqueue one BullMQ job on the webhook.deliver queue.
 *
 * The actual lookup of Webhook rows is injected; this keeps the bridge independent
 * of MikroORM and easy to test.
 */

export interface SubscriptionLookup {
  findActiveByEventType(eventType: string): Promise<
    Array<{ webhookId: string; url: string; secret: string }>
  >;
}

export interface EventBridgeOptions {
  eventBus: EventBus;
  queue: Pick<Queue<WebhookJobData>, 'add'>;
  subscriptionLookup: SubscriptionLookup;
  /** Events to bridge. Example: `['order.created.v1', 'order.updated.v1']`. */
  bridgedEventTypes: string[];
}

export interface BridgedEventPayload extends EventBase {
  // Domain events extend EventBase with their payload; the bridge serialises both
  // envelope and payload together so subscribers receive the whole shape.
  [key: string]: unknown;
}

export function wireEventBridge(opts: EventBridgeOptions): () => void {
  const unsubs: Array<() => void> = [];
  for (const eventType of opts.bridgedEventTypes) {
    const unsub = opts.eventBus.on(eventType, async (payload) => {
      const subs = await opts.subscriptionLookup.findActiveByEventType(eventType);
      for (const sub of subs) {
        const jobData: WebhookJobData = {
          webhookId: sub.webhookId,
          eventId: (payload as BridgedEventPayload).eventId ?? randomUUID(),
          eventType,
          payload,
          url: sub.url,
          secret: sub.secret,
        };
        await opts.queue.add(`${eventType}.${jobData.eventId}`, jobData);
      }
    });
    unsubs.push(unsub);
  }
  return () => unsubs.forEach((u) => u());
}
