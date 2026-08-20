import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import { enterSystemScope } from '../../../kernel/scope.js';
import type Redis from 'ioredis';

/**
 * BullMQ queue manager for outbound webhook delivery (R-13).
 *
 * - Single queue `webhook.deliver` with exponential-backoff retries.
 * - Payloads are opaque; the worker signs + POSTs them.
 * - Dead-letter is handled by BullMQ's `failed` job state — consumable by the admin
 *   panel's failed-deliveries view.
 */

export interface WebhookJobData {
  webhookId: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  /** Receiver URL at enqueue time (copied so URL changes don't retroactively affect queued jobs). */
  url: string;
  /** HMAC signing secret at enqueue time. */
  secret: string;
}

export const WEBHOOK_QUEUE_NAME = 'webhook.deliver';

const DEFAULT_ATTEMPTS = 8;
const DEFAULT_BACKOFF = { type: 'exponential' as const, delay: 1_000 };

export function createWebhookQueue(redis: Redis, overrides?: Partial<QueueOptions>): Queue<WebhookJobData> {
  const options: QueueOptions = {
    connection: redis,
    defaultJobOptions: {
      attempts: DEFAULT_ATTEMPTS,
      backoff: DEFAULT_BACKOFF,
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 5_000 },
    },
    ...overrides,
  };
  return new Queue<WebhookJobData>(WEBHOOK_QUEUE_NAME, options);
}

export function createWebhookWorker(
  redis: Redis,
  processor: Processor<WebhookJobData>,
  overrides?: Partial<WorkerOptions>,
): Worker<WebhookJobData> {
  const options: WorkerOptions = {
    connection: redis,
    concurrency: 8,
    ...overrides,
  };
  // Feature 072 (T033) — a delivery job runs detached, so it establishes its
  // own scope here. Before this it established NOTHING: it survived only
  // because `Webhook` and `WebhookDelivery` carry no automatic tenant filter,
  // which is a fact about their classification, not a guarantee.
  return new Worker<WebhookJobData>(
    WEBHOOK_QUEUE_NAME,
    (job) => enterSystemScope('webhooks: deliver', () => processor(job)),
    options,
  );
}
