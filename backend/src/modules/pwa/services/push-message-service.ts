import type { EntityManager } from '@mikro-orm/postgresql';
import type { Queue } from 'bullmq';
import type { PushAudience, PushTrigger } from '@b2b/contracts';
import { PushMessage } from '../entities/push-message.entity.js';
import { PushMessageDelivery } from '../entities/push-message-delivery.entity.js';
import { PushSubscription } from '../entities/push-subscription.entity.js';
import type { PushDeliveryJobData } from './push-delivery-queue.js';

export interface CreateMessageInput {
  salesChannelId: string;
  title: string;
  body: string;
  url?: string | null;
  iconUrl?: string | null;
  audience: PushAudience;
  trigger: PushTrigger;
  sourceEventId?: string | null;
  createdByAdminUserId?: string | null;
}

export interface CreateMessageResult {
  messageId: string;
  queuedDeliveries: number;
}

/**
 * Push message lifecycle (US4). Creates a message, expands the audience into
 * delivery rows, and enqueues one BullMQ job per delivery (producer-only — it
 * never sends inline, Principle X). Event-triggered messages are idempotent on
 * `(trigger, source_event_id)` via the partial unique index.
 */
export class PushMessageService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly queue: Queue<PushDeliveryJobData>,
  ) {}

  async createAndEnqueue(input: CreateMessageInput): Promise<CreateMessageResult> {
    const em = this.emFactory();

    // Idempotency guard for event-triggered sends: a duplicate event is a no-op.
    if (input.sourceEventId) {
      const dup = await em.findOne(PushMessage, {
        trigger: input.trigger,
        sourceEventId: input.sourceEventId,
      });
      if (dup) return { messageId: dup.id, queuedDeliveries: 0 };
    }

    const message = em.create(PushMessage, {
      salesChannelId: input.salesChannelId,
      title: input.title,
      body: input.body,
      url: input.url ?? null,
      iconUrl: input.iconUrl ?? null,
      audience: input.audience,
      trigger: input.trigger,
      sourceEventId: input.sourceEventId ?? null,
      status: 'queued',
      sentCount: 0,
      failedCount: 0,
      createdByAdminUserId: input.createdByAdminUserId ?? null,
    });
    await em.persistAndFlush(message);

    const subscriptions = await this.resolveAudience(em, input.salesChannelId, input.audience);
    const deliveries = subscriptions.map((sub) =>
      em.create(PushMessageDelivery, {
        messageId: message.id,
        subscriptionId: sub.id,
        status: 'pending',
        attempts: 0,
      }),
    );
    if (deliveries.length > 0) {
      await em.persistAndFlush(deliveries);
      await this.queue.addBulk(
        deliveries.map((d) => ({
          name: 'deliver',
          data: { deliveryId: d.id },
          opts: { jobId: d.id },
        })),
      );
    }

    return { messageId: message.id, queuedDeliveries: deliveries.length };
  }

  private async resolveAudience(
    em: EntityManager,
    salesChannelId: string,
    audience: PushAudience,
  ): Promise<PushSubscription[]> {
    if (audience.kind === 'all') {
      return em.find(PushSubscription, { salesChannelId, status: 'active' });
    }
    return em.find(PushSubscription, {
      salesChannelId,
      status: 'active',
      customerAccountId: { $in: audience.customerAccountIds },
    });
  }
}
