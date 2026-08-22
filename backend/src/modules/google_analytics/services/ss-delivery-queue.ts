import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import { enterSystemScope } from '../../../kernel/scope.js';
import type Redis from 'ioredis';
import type { GaCollectRequest } from '@endora-commerce/contracts';

/**
 * BullMQ queue for server-side Google Analytics event delivery (feature 049,
 * US4 / Principle X). The storefront `/collect` route is a pure producer: it
 * validates and enqueues one job per event; this worker forwards each event to
 * the channel's GA4 destination (Measurement Protocol or server-side GTM),
 * throwing on failure so BullMQ retries. Idempotency key: `eventId`.
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
 * event, enqueues a delivery job for each, and returns how many were accepted.
 */
export type GaCollectEnqueuer = (
  salesChannelId: string,
  request: GaCollectRequest,
) => Promise<number>;

export const GA_DELIVERY_QUEUE_NAME = 'google_analytics.ss.deliver';

const DEFAULT_ATTEMPTS = 8;
const DEFAULT_BACKOFF = { type: 'exponential' as const, delay: 1_000 };

export function createGaDeliveryQueue(
  redis: Redis,
  overrides?: Partial<QueueOptions>,
): Queue<GaDeliveryJobData> {
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
