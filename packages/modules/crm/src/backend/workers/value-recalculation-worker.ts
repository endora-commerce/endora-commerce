import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, type PlatformLogger } from '@endora-commerce/platform/kernel';

/**
 * Recalculating every computed Opportunity after the counting configuration
 * changed (`specs/143-crm-sales-opportunities/research.md` R-14, Constitution X).
 *
 * The configuration endpoint saves the set and **only enqueues**: how many
 * Opportunities there are is not a request's business. One job is one pass over
 * every computed Opportunity, carries no data — what counts is read from the
 * table when the job runs — and is idempotent, so a job delivered twice, or two
 * saves in a row, cost a second pass that changes nothing.
 *
 * A composition without queues (`moduleQueueRedis` undefined — the shared test
 * server) enqueues nothing and builds no consumer; its tests drive the pass
 * directly.
 */

export const VALUE_RECALCULATION_QUEUE = 'crm-value-recalculation';
export const VALUE_RECALCULATION_JOB = 'recalculate-all';

export type ValueRecalculationJobData = Record<string, never>;

const SCOPE_REASON = 'crm: recalculate computed opportunity values';

export interface ValueRecalculationProducer {
  /** Ask for one pass. Answers whether a job was enqueued. */
  enqueue(): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * The producing side. The queue is built on first use, so a process that never
 * saves the configuration opens nothing.
 */
export function createValueRecalculationProducer(redis: Redis | undefined): ValueRecalculationProducer {
  let queue: Queue<ValueRecalculationJobData> | undefined;
  return {
    async enqueue(): Promise<boolean> {
      if (redis === undefined) return false;
      queue ??= new Queue<ValueRecalculationJobData>(VALUE_RECALCULATION_QUEUE, {
        connection: redis,
        // A pass is worth nothing once it has run; a failed one is kept a
        // while for whoever looks at the queue.
        defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
      });
      await queue.add(VALUE_RECALCULATION_JOB, {});
      return true;
    },
    async close(): Promise<void> {
      await queue?.close();
      queue = undefined;
    },
  };
}

export interface ValueRecalculationDeps {
  /** One pass over every computed Opportunity; answers how many figures changed. */
  readonly recalculateAll: () => Promise<number>;
  readonly log: PlatformLogger;
}

/**
 * The body of one job: one pass. A failure fails the job — unlike a periodic
 * tick there is no next one coming, so BullMQ's record of the failure is the
 * only trace.
 */
export function valueRecalculationJob(deps: ValueRecalculationDeps): () => Promise<void> {
  return async () => {
    const changed = await deps.recalculateAll();
    deps.log.info({ changed }, 'crm: computed opportunity values recalculated');
  };
}

/**
 * Build and attach the consumer — where the host says this process runs one
 * (`processRunsWorkers`) **and** offers a connection to build it on. `attach`
 * is the platform's worker seam, `ctx.worker`, which is what makes the consumer
 * stop with the module. Answers whether a consumer was started.
 */
export function startValueRecalculation(
  input: ValueRecalculationDeps & {
    readonly processRunsWorkers: boolean;
    readonly moduleQueueRedis: Redis | undefined;
    readonly attach: (worker: Worker<ValueRecalculationJobData>) => void;
  },
): boolean {
  const { processRunsWorkers, moduleQueueRedis } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const job = valueRecalculationJob(input);
  input.attach(
    // The scope is written at the site that has no caller — the function
    // BullMQ invokes: there is no request behind a job, and the pass is
    // platform-wide by design.
    new Worker<ValueRecalculationJobData>(VALUE_RECALCULATION_QUEUE, () => enterSystemScope(SCOPE_REASON, job), {
      connection: moduleQueueRedis,
      // One pass at a time per process: two at once would only contend for the
      // same rows.
      concurrency: 1,
    }),
  );
  return true;
}
