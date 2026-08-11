import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import type Redis from 'ioredis';
import { enterSystemScope } from '../../../../kernel/scope.js';

/**
 * BullMQ queues for the Product Feed module (feature 067, Principle X).
 *
 * Two durable, Redis-backed queues:
 *  - `product_feeds.generate` — one job per generation attempt. The
 *    `product_feed_runs` row plus the conditional-`UPDATE` claim on
 *    `product_feeds.current_run_id` (data-model §5) is the idempotency anchor,
 *    so a redelivered job that finds the run past `queued` exits cleanly.
 *  - `product_feeds.reap` — the module-wide sweep that releases claims whose
 *    heartbeat went stale (FR-036).
 *
 * Producers (the manual-run HTTP handler, the per-feed Job Scheduler) only
 * enqueue and return. Consumers are registered through
 * `defineModuleWorker('product_feeds', …)` as separable entrypoints and run
 * co-located unless `BACKEND_ROLE=api`.
 *
 * Retries are deliberately few: a generation attempt is expensive, and a
 * failure is nearly always a configuration problem the operator must see
 * rather than something a retry fixes.
 */

export const FEED_GENERATION_QUEUE = 'product_feeds.generate';
export const FEED_REAPER_QUEUE = 'product_feeds.reap';

export interface FeedGenerationJobData {
  productFeedId: string;
  /** Pre-created run row; the worker claims against it. */
  feedRunId: string;
}

export type FeedReaperJobData = Record<string, never>;

const GENERATION_JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1_000 },
};

const REAPER_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 50 },
};

export function createFeedGenerationQueue(
  redis: Redis,
  overrides?: Partial<QueueOptions>,
): Queue<FeedGenerationJobData> {
  return new Queue<FeedGenerationJobData>(FEED_GENERATION_QUEUE, {
    connection: redis,
    defaultJobOptions: GENERATION_JOB_OPTIONS,
    ...overrides,
  });
}

export function createFeedGenerationWorker(
  redis: Redis,
  processor: Processor<FeedGenerationJobData>,
  overrides?: Partial<WorkerOptions>,
): Worker<FeedGenerationJobData> {
  return new Worker<FeedGenerationJobData>(
    FEED_GENERATION_QUEUE,
    (job) =>
      enterSystemScope(`product_feeds: generate feed ${job.data.productFeedId}`, () =>
        processor(job),
      ),
    { connection: redis, concurrency: 2, ...overrides },
  );
}

export function createFeedReaperQueue(
  redis: Redis,
  overrides?: Partial<QueueOptions>,
): Queue<FeedReaperJobData> {
  return new Queue<FeedReaperJobData>(FEED_REAPER_QUEUE, {
    connection: redis,
    defaultJobOptions: REAPER_JOB_OPTIONS,
    ...overrides,
  });
}

export function createFeedReaperWorker(
  redis: Redis,
  processor: Processor<FeedReaperJobData>,
  overrides?: Partial<WorkerOptions>,
): Worker<FeedReaperJobData> {
  return new Worker<FeedReaperJobData>(
    FEED_REAPER_QUEUE,
    (job) => enterSystemScope('product_feeds: release stale run claims', () => processor(job)),
    { connection: redis, concurrency: 1, ...overrides },
  );
}
