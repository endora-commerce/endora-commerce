import { Queue, Worker, type KeepJobs, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import type { Redis } from 'ioredis';
import type { GaCollectRequest } from '@endora-commerce/contracts';

/**
 * BullMQ queue for server-side Google Analytics event delivery (feature 049,
 * US4 / Principle X). The storefront `/collect` route is a pure producer: it
 * validates and enqueues one job per event; this worker forwards each event to
 * the channel's GA4 destination (Measurement Protocol or server-side GTM),
 * throwing on failure so BullMQ retries. Idempotency key: `eventId`.
 *
 * A job carries the visitor's `clientId` and the event's `params`, so a
 * finished job is kept in Redis by age as well as by count (issue #1248): see
 * {@link GA_DELIVERY_KEEP_COMPLETED} and {@link GA_DELIVERY_KEEP_FAILED}.
 */
export interface GaDeliveryJobData {
  eventId: string;
  salesChannelId: string;
  clientId: string;
  event: { name: string; params: Record<string, string | number | boolean> };
  consent: { analyticsStorage: 'granted' | 'denied' };
  occurredAt: string;
}

/**
 * Producer callback exposed to the storefront route. Assigns an `eventId` per
 * event, enqueues a delivery job for each, and returns how many were accepted —
 * zero, with nothing enqueued, for a channel whose server-side delivery is not
 * configured.
 */
export type GaCollectEnqueuer = (
  salesChannelId: string,
  request: GaCollectRequest,
) => Promise<number>;

export const GA_DELIVERY_QUEUE_NAME = 'google_analytics.ss.deliver';

const DEFAULT_ATTEMPTS = 8;
const DEFAULT_BACKOFF = { type: 'exponential' as const, delay: 1_000 };
const HOUR_SECONDS = 60 * 60;

/**
 * How long BullMQ keeps a delivered job (issue #1248): one hour. A delivered
 * event has nothing left to say, and GA4 holds the copy that matters; the hour
 * is a short tail for an operator looking at the queue.
 */
export const GA_DELIVERY_KEEP_COMPLETED = { age: HOUR_SECONDS, count: 500 } satisfies KeepJobs;

/**
 * How long BullMQ keeps a job that ran out of retries (issue #1248): three
 * days, long enough to diagnose a failing destination over a weekend, and no
 * longer, because the job still holds the visitor's data.
 *
 * BullMQ applies both bounds only when another job finishes in the same set,
 * so a quiet queue would keep its last jobs indefinitely; the hourly sweep in
 * `ss-delivery-sweep.ts` is the clock that does not depend on traffic.
 */
export const GA_DELIVERY_KEEP_FAILED = { age: 3 * 24 * HOUR_SECONDS, count: 5_000 } satisfies KeepJobs;

export function createGaDeliveryQueue(
  redis: Redis,
  overrides?: Partial<QueueOptions>,
): Queue<GaDeliveryJobData> {
  const options: QueueOptions = {
    connection: redis,
    defaultJobOptions: {
      attempts: DEFAULT_ATTEMPTS,
      backoff: DEFAULT_BACKOFF,
      removeOnComplete: GA_DELIVERY_KEEP_COMPLETED,
      removeOnFail: GA_DELIVERY_KEEP_FAILED,
    },
    ...overrides,
  };
  return new Queue<GaDeliveryJobData>(GA_DELIVERY_QUEUE_NAME, options);
}

export function createGaDeliveryWorker(
  redis: Redis,
  processor: Processor<GaDeliveryJobData>,
  overrides?: Partial<WorkerOptions>,
): Worker<GaDeliveryJobData> {
  const options: WorkerOptions = {
    connection: redis,
    concurrency: 8,
    ...overrides,
  };
  // Feature 072 (T033) — the job establishes its own scope; it established
  // nothing before.
  return new Worker<GaDeliveryJobData>(
    GA_DELIVERY_QUEUE_NAME,
    (job) => enterSystemScope('google_analytics: server-side delivery', () => processor(job)),
    options,
  );
}
