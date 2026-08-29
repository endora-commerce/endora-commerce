import type { EntityManager } from '@mikro-orm/postgresql';
import type { Job } from 'bullmq';
import type { PushProviderRegistryPort } from '@endora-commerce/contracts';
import { PushMessage } from '../entities/push-message.entity.js';
import { PushMessageDelivery } from '../entities/push-message-delivery.entity.js';
import { PushSubscription } from '../entities/push-subscription.entity.js';
import type { PushDeliveryJobData } from '../services/push-delivery-queue.js';

export interface PushDeliveryProcessorDeps {
  emFactory: () => EntityManager;
  registry: PushProviderRegistryPort;
}

/**
 * Push delivery processor (Principle X). Sends one delivery row, idempotent on
 * the unique (message_id, subscription_id): an already-`sent` row is skipped so
 * BullMQ retries never produce a duplicate user-visible push. A `gone` result
 * prunes the dead subscription (FR-022). Retryable failures throw to let BullMQ
 * back off and retry.
 */
export function makePushDeliveryProcessor(deps: PushDeliveryProcessorDeps) {
  // command-coverage-ignore: delivery-state bookkeeping for an operation already
  // audited at its start — the operator's write was creating and sending the
  // PushMessage. Attempt counters, `sent`/`failed`/`pruned` transitions and the
  // pruning of a subscription the push endpoint reported `gone` are the machine
  // reporting on that one decision; an audit row per delivery would say nothing
  // about who did what, and there are as many as there are subscribers.
  //
  // Feature 050 — a BullMQ job runs detached and needs an ambient tenant
  // context for the PushSubscription reads (fail-closed guard). Feature 072
  // (T033) moved that wrapper out to the `new Worker(...)` site, where every
  // other queue in the tree puts it, so the processor is a plain function again.
  return async (job: Job<PushDeliveryJobData>): Promise<void> => {
    const em = deps.emFactory();
    const delivery = await em.findOne(PushMessageDelivery, { id: job.data.deliveryId });
    if (!delivery) return; // delivery (or its message) was removed — nothing to do
    if (delivery.status === 'sent' || delivery.status === 'pruned') return; // idempotent

    const [message, subscription] = await Promise.all([
      em.findOne(PushMessage, { id: delivery.messageId }),
      em.findOne(PushSubscription, { id: delivery.subscriptionId }),
    ]);

    if (!message || !subscription || subscription.status !== 'active') {
      delivery.status = 'failed';
      delivery.lastError = 'message or subscription missing/inactive';
      delivery.attemptedAt = new Date();
      await em.flush();
      return;
    }

    const provider =
      deps.registry.get(subscription.provider) ??
      (await deps.registry.resolveDefault(message.salesChannelId));

    delivery.attempts += 1;
    delivery.attemptedAt = new Date();

    const result = await provider.send(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        provider: subscription.provider,
        salesChannelId: message.salesChannelId,
      },
      {
        title: message.title,
        body: message.body,
        ...(message.iconUrl ? { iconUrl: message.iconUrl } : {}),
        ...(message.url ? { url: message.url } : {}),
        tag: message.id,
      },
    );

    if (result.ok) {
      delivery.status = 'sent';
      message.sentCount += 1;
      await em.flush();
      await maybeFinalize(em, message);
      return;
    }

    if (result.gone === true) {
      delivery.status = 'pruned';
      subscription.status = 'invalid';
      message.failedCount += 1;
      await em.flush();
      await em.removeAndFlush(subscription);
      await maybeFinalize(em, message);
      return;
    }

    // Non-`gone` failure.
    delivery.lastError = result.error;
    if (result.retryable) {
      // Persist the attempt counter, then throw so BullMQ retries/backs off.
      delivery.status = 'pending';
      await em.flush();
      throw new Error(`push delivery ${delivery.id} failed (retryable): ${result.error}`);
    }
    delivery.status = 'failed';
    message.failedCount += 1;
    await em.flush();
    await maybeFinalize(em, message);
  };
}

/**
 * Flip the parent message to a terminal status once every delivery has resolved.
 * Best-effort — not transactional with the delivery write (the counts are the
 * source of truth for the admin history).
 */
async function maybeFinalize(em: EntityManager, message: PushMessage): Promise<void> {
  // command-coverage-ignore: closes out the same already-audited send. The
  // terminal status is derived from the delivery counts, not chosen by anybody.
  const pending = await em.count(PushMessageDelivery, {
    messageId: message.id,
    status: 'pending',
  });
  if (pending > 0) return;
  message.status = message.failedCount > 0 && message.sentCount === 0 ? 'failed' : 'sent';
  message.sentAt = new Date();
  await em.flush();
}
