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
  /**
   * Feature 062 — org-scoped delivery (contracts/order-webhooks.md §2).
   * `organizationId` is the value extracted from the event payload (or null
   * when the payload carries none). Implementations return active
   * subscriptions matching the event type where the subscription is
   * platform-wide (`organizationId` NULL, legacy semantics — FR-015) OR bound
   * to exactly this organization. An event without an organization must never
   * reach an org-scoped subscription (fail closed — Principle XI).
   */
  findActiveByEventType(
    eventType: string,
    organizationId: string | null,
  ): Promise<Array<{ webhookId: string; url: string; secret: string }>>;
}

/**
 * Delivery-filter predicate shared by the subscription lookup: a subscription
 * receives the event iff it is platform-wide, or the event carries an
 * organization and it matches the subscription's binding.
 */
export function subscriptionReceivesOrganization(
  subscriptionOrganizationId: string | null,
  eventOrganizationId: string | null,
): boolean {
  if (subscriptionOrganizationId === null) return true;
  return eventOrganizationId !== null && subscriptionOrganizationId === eventOrganizationId;
}

/** Extract the tenant key from a bridged event payload; non-string values count as absent. */
function extractOrganizationId(payload: unknown): string | null {
  const value = (payload as Record<string, unknown>)['organizationId'];
  return typeof value === 'string' && value.length > 0 ? value : null;
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
      const subs = await opts.subscriptionLookup.findActiveByEventType(
        eventType,
        extractOrganizationId(payload),
      );
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
