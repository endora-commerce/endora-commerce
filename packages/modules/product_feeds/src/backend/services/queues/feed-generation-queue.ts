import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';

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
 * enqueue and return. Consumers are constructed in `workers/` and registered
 * through `ctx.worker` as separable entrypoints; they run co-located unless
 * `BACKEND_ROLE=api`.
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

export const FEED_REAPER_SCOPE_REASON = 'product_feeds: release stale run claims';

/**
 * What BullMQ invokes for one reaper job: ask whether any run holds a claim at
 * all, and open the system scope only when one does (issue #120).
 *
 * Entering the scope is what writes the `tenant.escape_hatch` audit record, and
 * a tick is five minutes from the last — further apart than the audit writer's
 * aggregation window — so a scope entered on every tick is 288 audit rows a day
 * on an installation that has never generated a feed.
 *
 * **`hasWork` is asked outside any scope and answers yes or no, nothing
 * else.** Everything the sweep reads or writes is still read inside the scope,
 * by `sweep` itself — the answer decides only *whether* the scope is
 * entered.
 *
 * **A question that cannot be answered counts as yes.** The tick then runs as
 * it always did, scope and audit record included: a failing probe may cost an
 * audit row, and can never save one.
 */
export async function runFeedReaperJob(
  hasWork: () => Promise<boolean>,
  sweep: () => Promise<unknown>,
): Promise<void> {
  let work = true;
  try {
    work = await hasWork();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    work = true;
  }
  if (!work) return;
  await enterSystemScope(FEED_REAPER_SCOPE_REASON, sweep);
}

export function createFeedReaperWorker(
  redis: Redis,
  hasWork: () => Promise<boolean>,
  processor: Processor<FeedReaperJobData>,
  overrides?: Partial<WorkerOptions>,
): Worker<FeedReaperJobData> {
  return new Worker<FeedReaperJobData>(
    FEED_REAPER_QUEUE,
    (job, token) => runFeedReaperJob(hasWork, () => processor(job, token)),
    { connection: redis, concurrency: 1, ...overrides },
  );
}
