import type { Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { defineModuleWorker } from '../../../kernel/lifecycle/plugin-helpers.js';
import type { FeedRunReaperService } from '../services/feed-run-reaper.service.js';
import {
  createFeedReaperWorker,
  type FeedReaperJobData,
} from '../services/queues/feed-generation-queue.js';

/**
 * Stale-claim sweep — feature 067 / FR-036, T076.
 *
 * A second, **module-wide** Job Scheduler (one, not one per feed) firing every
 * five minutes. It is a scheduler rather than a `setInterval` for the same
 * reason everything else here is: Principle X prohibits timers inside the API
 * process, and a Redis-held schedule survives a deploy while an interval does
 * not.
 *
 * Five minutes against a 30-minute default stale threshold gives roughly six
 * chances to notice a dead worker before anyone would call it a stuck feed,
 * while costing one trivial indexed query per tick on an installation with no
 * scheduled feeds at all.
 *
 * The sweep never throws out of the handler. A reaper that fails a job on a
 * transient database blip would be retried, log noise, and eventually be
 * silently disabled by an operator — whereas the next tick five minutes later
 * fixes the same rows.
 */

export const FEED_REAPER_SCHEDULER_ID = 'product_feeds:reaper';

/** Every five minutes, on the module-wide sweep queue. */
export const FEED_REAPER_CRON = '*/5 * * * *';

export interface FeedRunReaperWorkerDeps {
  redis: Redis;
  reaper: FeedRunReaperService;
  logWarn?: (message: string, detail: Record<string, unknown>) => void;
}

export function registerFeedRunReaperWorker(
  deps: FeedRunReaperWorkerDeps,
): Worker<FeedReaperJobData> {
  return defineModuleWorker(
    'product_feeds',
    createFeedReaperWorker(deps.redis, async () => {
      try {
        await deps.reaper.releaseStaleClaims();
      } catch (err) {
        // Logged, never rethrown — see the note above.
        deps.logWarn?.('product_feeds: stale-claim sweep failed', { error: String(err) });
      }
    }),
  );
}

/**
 * Installs the module-wide sweep schedule. Idempotent by scheduler id, so it is
 * safe to call on every boot of every worker process — which is exactly how it
 * is called.
 */
export async function ensureReaperSchedule(queue: Queue<FeedReaperJobData>): Promise<void> {
  await queue.upsertJobScheduler(
    FEED_REAPER_SCHEDULER_ID,
    // No `tz`: a sweep every five minutes has no local-time meaning, and giving
    // it one would make it skip or repeat an interval across a DST transition
    // for no benefit.
    { pattern: FEED_REAPER_CRON },
    { name: 'reap', data: {} },
  );
}
