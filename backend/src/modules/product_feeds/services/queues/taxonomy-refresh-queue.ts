import { Queue, Worker, type Processor, type QueueOptions, type WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope } from '../../../../kernel/scope.js';

/**
 * The taxonomy-check queue — feature 067 / FR-089, research §R21.
 *
 * A third durable queue for the module, on the same shape as the reaper's: one
 * **module-wide** Job Scheduler rather than one per provider, because a check
 * is two HTTP requests and a per-provider scheduler would double the
 * scheduling surface for nothing.
 *
 * `attempts: 1` is deliberate and is the whole failure posture in one option.
 * The handler never throws (`TaxonomyRefreshService.runCheck` records every
 * outcome and returns), so there is nothing for BullMQ to retry; and if there
 * were, retrying a third party's web server inside a tick is how a weekly check
 * becomes a retry storm. The next tick is the retry, and the operator has
 * "Check now" for impatience.
 */

export const TAXONOMY_REFRESH_QUEUE = 'product_feeds.taxonomy_refresh';

export interface TaxonomyRefreshJobData {
  /** Omitted ⇒ the scheduled sweep over every provider. */
  providerCode?: 'google_merchant' | 'meta';
  /** Set by a manual trigger so the worker closes the row the route opened. */
  checkId?: string;
}

const TAXONOMY_REFRESH_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 50 },
};

export function createTaxonomyRefreshQueue(
  redis: Redis,
  overrides?: Partial<QueueOptions>,
): Queue<TaxonomyRefreshJobData> {
  return new Queue<TaxonomyRefreshJobData>(TAXONOMY_REFRESH_QUEUE, {
    connection: redis,
    defaultJobOptions: TAXONOMY_REFRESH_JOB_OPTIONS,
    ...overrides,
  });
}

export function createTaxonomyRefreshWorker(
  redis: Redis,
  processor: Processor<TaxonomyRefreshJobData>,
  overrides?: Partial<WorkerOptions>,
): Worker<TaxonomyRefreshJobData> {
  return new Worker<TaxonomyRefreshJobData>(
    TAXONOMY_REFRESH_QUEUE,
    (job) =>
      enterSystemScope(
        `product_feeds: taxonomy check ${job.data.providerCode ?? 'all providers'}`,
        () => processor(job),
      ),
    // One at a time: two concurrent checks of the same provider would race on
    // the in-flight predicate for no benefit, and the work is two downloads.
    { connection: redis, concurrency: 1, ...overrides },
  );
}
