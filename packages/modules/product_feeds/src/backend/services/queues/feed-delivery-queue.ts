import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { FEED_DELIVERY_LIMITS } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';

/**
 * The delivery queue — feature 070 / FR-103, FR-104, Principle X.
 *
 * A queue of its own rather than a step inside `product_feeds.generate`, and
 * that separation is FR-103 made structural: the generation job has already
 * finished and published by the time this one starts, so no delivery failure —
 * and no delivery *retry* — can touch the run's status or its counters.
 *
 * Retries are generous here, unlike the generation queue's `attempts: 2`. A
 * failed generation is nearly always a configuration problem an operator must
 * see; a failed delivery is nearly always somebody else's server being briefly
 * unavailable, which is exactly what backoff is for. `attempts` is capped rather
 * than unbounded (FR-104): a partner who has decommissioned an endpoint should
 * produce five rows and a notification, not one row a minute forever.
 */

export const FEED_DELIVERY_QUEUE = 'product_feeds.deliver';

export interface FeedDeliveryJobData {
  productFeedId: string;
  /** Null for a delivery not tied to a run — nothing produces one today. */
  feedRunId: string | null;
  feedArtefactId: string;
}

const DELIVERY_JOB_OPTIONS = {
  attempts: FEED_DELIVERY_LIMITS.DEFAULT_MAX_ATTEMPTS,
  backoff: { type: 'exponential' as const, delay: FEED_DELIVERY_LIMITS.RETRY_BACKOFF_MS },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1_000 },
};

export function createFeedDeliveryQueue(
  redis: Redis,
  overrides?: Partial<QueueOptions>,
): Queue<FeedDeliveryJobData> {
  return new Queue<FeedDeliveryJobData>(FEED_DELIVERY_QUEUE, {
    connection: redis,
    defaultJobOptions: DELIVERY_JOB_OPTIONS,
    ...overrides,
  });
}

export function createFeedDeliveryWorker(
  redis: Redis,
  processor: Processor<FeedDeliveryJobData>,
  overrides?: Partial<WorkerOptions>,
): Worker<FeedDeliveryJobData> {
  return new Worker<FeedDeliveryJobData>(
    FEED_DELIVERY_QUEUE,
    (job) =>
      enterSystemScope(`product_feeds: deliver feed ${job.data.productFeedId}`, () =>
        processor(job),
      ),
    // Deliberately low: each job holds an open socket to somebody else's server
    // for as long as a multi-megabyte upload takes.
    { connection: redis, concurrency: 2, ...overrides },
  );
}
