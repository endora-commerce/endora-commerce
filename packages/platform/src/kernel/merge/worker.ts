import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { RECORD_MERGE_QUEUE } from '@endora-commerce/contracts';
import type { PlatformLogger } from '../logging.js';
import { enterSystemScope } from '../scope.js';
import { runRecordMerge, type RecordMergeRunnerDeps } from './runner.js';
import type { RecordMergeStore } from './store.js';

/**
 * The merge runner's queue (`specs/192-organization-merge/` research R-2,
 * R-10; Principle X): one BullMQ job per merge (`jobId` = merge id, so a
 * duplicate enqueue while one is waiting or running is a no-op, and a finished
 * job is removed so a resume can enqueue again), plus a repeatable catch-up
 * sweep. The presence notification triggers the same catch-up immediately;
 * the sweep is what survives a lost notification and a crash between a start's
 * commit and its enqueue.
 */

export const RECORD_MERGE_CATCH_UP_SCHEDULER_ID = 'platform.record-merge.catch-up';
export const RECORD_MERGE_CATCH_UP_EVERY_MS = 15 * 60_000;
/** Merges run at once in one worker process. */
export const RECORD_MERGE_WORKER_CONCURRENCY = 2;

export type RecordMergeJobData = { readonly kind: 'run'; readonly mergeId: string } | { readonly kind: 'catch-up' };

export interface RecordMergeCatchUpDeps {
  readonly store: Pick<RecordMergeStore, 'catchUpCandidates'>;
  readonly isPresent: (moduleId: string) => boolean;
  readonly enqueue: (mergeId: string) => Promise<void>;
}

/**
 * Every merge that has work now: a running one (always), and a completed one
 * with a deferred or unfinished trailing step whose module is present.
 */
export async function runRecordMergeCatchUp(deps: RecordMergeCatchUpDeps): Promise<string[]> {
  const enqueued: string[] = [];
  for (const candidate of await deps.store.catchUpCandidates()) {
    const due = candidate.state === 'running' || candidate.moduleIds.some((moduleId) => deps.isPresent(moduleId));
    if (!due) continue;
    await deps.enqueue(candidate.mergeId);
    enqueued.push(candidate.mergeId);
  }
  return enqueued;
}

/** One job: a merge to run, or the sweep. */
export async function processRecordMergeJob(
  data: RecordMergeJobData,
  deps: { readonly runner: RecordMergeRunnerDeps; readonly store: RecordMergeStore; readonly enqueue: (mergeId: string) => Promise<void> },
): Promise<void> {
  if (data.kind === 'run') {
    await runRecordMerge(data.mergeId, deps.runner);
    return;
  }
  await runRecordMergeCatchUp({ store: deps.store, isPresent: deps.runner.isPresent, enqueue: deps.enqueue });
}

/**
 * The pub/sub path: run the catch-up whenever module presence is installed
 * (a switch flipped here or announced by another process). Coalesced, so a
 * burst of notifications runs it once more at most.
 */
export function watchPresenceForCatchUp(
  onPresenceInstalled: (listener: () => void) => () => void,
  runCatchUp: () => Promise<void>,
  log?: Pick<PlatformLogger, 'warn'>,
): () => void {
  let running = false;
  let again = false;
  const trigger = (): void => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    void runCatchUp()
      .catch((error: unknown) => {
        log?.warn({ error: error instanceof Error ? error.message : String(error) }, 'record-merge: the catch-up failed');
      })
      .finally(() => {
        running = false;
        if (again) {
          again = false;
          trigger();
        }
      });
  };
  return onPresenceInstalled(trigger);
}

export function createRecordMergeQueue(redis: Redis, prefix?: string): Queue<RecordMergeJobData> {
  return new Queue<RecordMergeJobData>(RECORD_MERGE_QUEUE, {
    connection: redis,
    ...(prefix !== undefined ? { prefix } : {}),
    defaultJobOptions: { removeOnComplete: true, removeOnFail: true },
  });
}

/** The producer half: every process may enqueue, whether or not it runs the worker. */
export function recordMergeEnqueuer(queue: () => Queue<RecordMergeJobData> | undefined, log: Pick<PlatformLogger, 'warn'>) {
  return async (mergeId: string): Promise<void> => {
    const target = queue();
    if (target === undefined) return;
    try {
      await target.add('run', { kind: 'run', mergeId }, { jobId: mergeId });
    } catch (error) {
      // Not fatal: the catch-up sweep re-enqueues every running merge.
      log.warn({ mergeId, error: error instanceof Error ? error.message : String(error) }, 'record-merge: enqueue failed');
    }
  };
}

export function buildRecordMergeWorker(input: {
  readonly redis: Redis;
  readonly prefix?: string;
  readonly process: (data: RecordMergeJobData) => Promise<void>;
}): Worker<RecordMergeJobData> {
  // A job has no caller: it opens its own system scope, and each participant
  // call inside it opens the merge's own (`record-merge:<id>`).
  return new Worker<RecordMergeJobData>(
    RECORD_MERGE_QUEUE,
    (job) => enterSystemScope('record-merge: runner', () => input.process(job.data)),
    {
      connection: input.redis,
      concurrency: RECORD_MERGE_WORKER_CONCURRENCY,
      // A merge job can run for minutes (SC-002); the lock is renewed while it does.
      lockDuration: 5 * 60_000,
      ...(input.prefix !== undefined ? { prefix: input.prefix } : {}),
    },
  );
}

export async function ensureRecordMergeCatchUpSchedule(
  queue: Pick<Queue<RecordMergeJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    RECORD_MERGE_CATCH_UP_SCHEDULER_ID,
    { every: RECORD_MERGE_CATCH_UP_EVERY_MS },
    { name: 'catch-up', data: { kind: 'catch-up' } },
  );
}
