import type { Job, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { defineModuleWorker } from '../../../kernel/lifecycle/plugin-helpers.js';
import type { FeedGenerationService } from '../services/feed-generation.service.js';
import type { FeedRunService } from '../services/feed-run.service.js';
import {
  createFeedGenerationWorker,
  type FeedGenerationJobData,
} from '../services/queues/feed-generation-queue.js';

/**
 * Generation consumer — feature 067 / FR-032, FR-033, T075.
 *
 * The consumer half of `product_feeds.generate`. Registered through
 * `defineModuleWorker('product_feeds', …)` so the lifecycle orchestrator can
 * pause it when the module is disabled, and started only when
 * `BACKEND_ROLE !== 'api'` (Principle X).
 *
 * ## Two job shapes, one handler
 *
 * A **manual** run arrives with a `feedRunId`: the HTTP handler already created
 * the `queued` row so it could answer `202` with a run id the operator can
 * follow. A **scheduled** tick arrives with an empty `feedRunId`, because the
 * Job Scheduler's payload is fixed at upsert time and cannot carry a per-tick
 * row id. The worker creates the row for that case.
 *
 * ## Idempotence under redelivery
 *
 * BullMQ can redeliver a job — a lost heartbeat, a stalled-job reclaim, an
 * `attempts: 2` retry. The claim is the anchor: `claim()` only succeeds on a
 * feed with `current_run_id IS NULL`, so a redelivered job either re-claims a
 * run that was genuinely released (correct: the previous attempt died and the
 * reaper cleaned up) or records `skipped(already_running)` and returns. What it
 * must never do is start a second concurrent generation, and the conditional
 * `UPDATE` guarantees that across every worker process.
 *
 * A redelivery of a job whose run already reached a terminal state is refused
 * here rather than in the generator, so a completed run's counters can never be
 * overwritten by a late duplicate.
 */

export interface FeedGenerationWorkerDeps {
  redis: Redis;
  generation: FeedGenerationService;
  runs: FeedRunService;
  /** Structured, non-fatal logging; a worker must never throw on a log failure. */
  logWarn?: (message: string, detail: Record<string, unknown>) => void;
}

export function registerFeedGenerationWorker(
  deps: FeedGenerationWorkerDeps,
): Worker<FeedGenerationJobData> {
  return defineModuleWorker(
    'product_feeds',
    createFeedGenerationWorker(deps.redis, (job) => processGenerationJob(job, deps)),
  );
}

export async function processGenerationJob(
  job: Job<FeedGenerationJobData>,
  deps: Pick<FeedGenerationWorkerDeps, 'generation' | 'runs' | 'logWarn'>,
): Promise<void> {
  const { productFeedId, feedRunId } = job.data;
  if (!productFeedId) return;

  // A scheduled tick carries no run id — the Job Scheduler's payload is fixed
  // at upsert time, so the row is created per tick here.
  const scheduled = !feedRunId;
  if (scheduled) {
    await deps.generation.generateNow(productFeedId, { trigger: 'scheduled' });
    return;
  }

  // A manual run's row already exists. Refuse a redelivery of one that already
  // finished: re-running it would overwrite the counters an operator is looking
  // at with a second attempt's.
  const claimable = await deps.runs.isClaimable(feedRunId);
  if (!claimable) {
    deps.logWarn?.('product_feeds: generation job ignored, run is not queued', {
      productFeedId,
      feedRunId,
      jobId: job.id ?? null,
    });
    return;
  }

  await deps.generation.generateNow(productFeedId, {
    trigger: 'manual',
    runId: feedRunId,
  });
}
