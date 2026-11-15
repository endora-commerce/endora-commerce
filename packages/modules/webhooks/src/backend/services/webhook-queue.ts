import { Queue, Worker, type KeepJobs, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import type { Redis } from 'ioredis';
import { WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS } from './delivery-retention.js';

/**
 * BullMQ queue manager for outbound webhook delivery (R-13).
 *
 * - Single queue `webhook.deliver` with exponential-backoff retries.
 * - Payloads are opaque; the worker signs + POSTs them.
 * - Dead-letter is handled by BullMQ's `failed` job state — consumable by the admin
 *   panel's failed-deliveries view.
 * - A finished job is kept for no longer than the delivery-history retention
 *   window (issue #1003), see {@link webhookJobRetention}.
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

const KEEP_COMPLETED_COUNT = 500;
const KEEP_FAILED_COUNT = 5_000;
const DAY_SECONDS = 24 * 60 * 60;

/**
 * How long BullMQ keeps a finished `webhook.deliver` job (issue #1003).
 *
 * A job carries the event's payload and the receiver's signing secret, so its
 * copy in Redis is bounded by the same window as the `webhook_deliveries` row
 * (`webhooks.delivery_retention_days`, #928): by age as well as by count.
 *
 * BullMQ applies these bounds when a job *finishes*, with the finishing job's
 * own options, to the whole completed or failed set. So the bridge passes the
 * window it reads at enqueue time on every job, which makes a changed setting
 * apply from the next finished job; and since a quiet queue finishes no job,
 * the daily retention tick also removes what is past the window
 * (`WebhookDeliveryRetentionService.purge`).
 */
export function webhookJobRetention(retentionDays: number): {
  removeOnComplete: KeepJobs;
  removeOnFail: KeepJobs;
} {
  const age = retentionDays * DAY_SECONDS;
  return {
    removeOnComplete: { age, count: KEEP_COMPLETED_COUNT },
    removeOnFail: { age, count: KEEP_FAILED_COUNT },
  };
}

export function createWebhookQueue(redis: Redis, overrides?: Partial<QueueOptions>): Queue<WebhookJobData> {
  const options: QueueOptions = {
    connection: redis,
    defaultJobOptions: {
      attempts: DEFAULT_ATTEMPTS,
      backoff: DEFAULT_BACKOFF,
      // The default window, for a job added without options of its own.
      ...webhookJobRetention(WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS),
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
