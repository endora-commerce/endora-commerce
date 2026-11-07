import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, type PlatformLogger } from '@endora-commerce/platform/kernel';

/**
 * The price-surface refresh queue — feature 160 (research R7,
 * `contracts/price-surface.md` §4; Principle X).
 *
 * A pricing write marks every profile stale after its commit and enqueues one
 * **coalesced** job (a fixed job id while one is waiting, so a burst of writes
 * costs one rebuild); a request meeting a never-built profile enqueues the same
 * job. The worker builds never-built profiles first, then rebuilds the stale
 * ones, from their stored book vectors, and swaps each new generation in. The
 * job is idempotent — a rebuild recomputes from source and a profile already
 * rebuilt is skipped under its advisory lock — so a retry or a second worker is
 * harmless. Requests never wait for it (`contracts/price-surface.md` §3): a
 * stale profile keeps serving its previous surface meanwhile.
 *
 * A pass that cannot finish — a build whose products keep vanishing under it
 * after three fresh reads — throws, swapping nothing and keeping every mark,
 * so the job fails and BullMQ's own attempts and backoff run it again. A job
 * that fails for good is logged and removed, so the next request is a new job
 * rather than a duplicate of the failed one (issue #416, review 2 of #424).
 *
 * The fixed id also swallows a request made while a job is *finishing*: the
 * pass read no more work, and a mark committed after that read enqueues
 * against the still-active job. So a job that completes checks once more and,
 * when work is pending, asks for a follow-up job — by then the completed job
 * is removed, so the request is a new job (issue #427).
 *
 * Attached with `ctx.worker`, so it stops with the module (Principle XVII), and
 * built only where the host says this process consumes queues.
 */

export const PRICE_SURFACE_QUEUE = 'price_lists.surface';
export const PRICE_SURFACE_REBUILD_JOB = 'rebuild-stale';

const SCOPE_REASON = 'price_lists: rebuild the price surface';
const JOB_ATTEMPTS = 3;
const JOB_BACKOFF = { type: 'exponential', delay: 2_000 } as const;

export interface PriceSurfaceProducer {
  /** Ask for one rebuild pass; coalesced while one is waiting. Answers whether a job was enqueued. */
  enqueue(): Promise<boolean>;
  close(): Promise<void>;
}

export function createPriceSurfaceProducer(redis: Redis | undefined): PriceSurfaceProducer {
  let queue: Queue | undefined;
  return {
    async enqueue(): Promise<boolean> {
      if (redis === undefined) return false;
      queue ??= new Queue(PRICE_SURFACE_QUEUE, {
        connection: redis,
        defaultJobOptions: {
          removeOnComplete: true,
          // A failed job is not kept: its id is the one fixed id every request
          // uses, and BullMQ refuses an id it still holds, so a kept failure
          // would swallow every later request and leave the marks to nobody
          // (review 2 of #424). The worker logs each failure instead.
          removeOnFail: true,
          attempts: JOB_ATTEMPTS,
          backoff: JOB_BACKOFF,
        },
      });
      await queue.add(PRICE_SURFACE_REBUILD_JOB, {}, { jobId: PRICE_SURFACE_REBUILD_JOB });
      return true;
    },
    async close(): Promise<void> {
      await queue?.close();
      queue = undefined;
    },
  };
}

export function startPriceSurfaceWorker(input: {
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly rebuildStale: () => Promise<number>;
  /** Whether a pass would find work now; asked once each job completes (issue #427). */
  readonly hasPendingWork: () => Promise<boolean>;
  /** The producer's {@link PriceSurfaceProducer.enqueue}, for the follow-up job. */
  readonly enqueue: () => Promise<boolean>;
  readonly log: PlatformLogger;
  readonly attach: (worker: Worker) => void;
}): boolean {
  if (!input.processRunsWorkers || input.moduleQueueRedis === undefined) return false;
  const worker = new Worker(
    PRICE_SURFACE_QUEUE,
    () =>
      enterSystemScope(SCOPE_REASON, async () => {
        const rebuilt = await input.rebuildStale();
        if (rebuilt > 0) input.log.info({ rebuilt }, 'price_lists: price surface profiles rebuilt');
      }),
    { connection: input.moduleQueueRedis, concurrency: 1 },
  );
  worker.on('completed', () => {
    // `removeOnComplete` has removed the job by the time this fires, so the
    // follow-up is a new job rather than a duplicate of this one. A worker
    // that is stopping asks for nothing: the module is going away with it.
    if (worker.closing !== undefined) return;
    enterSystemScope(SCOPE_REASON, async () => {
      if (await input.hasPendingWork()) await input.enqueue();
    }).catch((err: unknown) => {
      input.log.error(
        { err },
        'price_lists: price surface follow-up check failed; pending marks wait for the next request',
      );
    });
  });
  worker.on('failed', (job, err) => {
    input.log.error(
      { err, attemptsMade: job?.attemptsMade, attempts: job?.opts.attempts },
      'price_lists: price surface rebuild failed; its marks are kept for the next attempt or request',
    );
  });
  input.attach(worker);
  return true;
}
