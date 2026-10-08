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

/** One Opportunity, asked for by the value service when it could not settle a figure itself. */
export const VALUE_RECALCULATION_ONE_JOB = 'recalculate-one';

export type ValueRecalculationJobData = { opportunityId?: string };

const SCOPE_REASON = 'crm: recalculate computed opportunity values';

/** How often a job is run before BullMQ records it as failed, and how long it waits in between. */
const JOB_ATTEMPTS = 3;
const JOB_BACKOFF = { type: 'exponential', delay: 5_000 } as const;

export interface ValueRecalculationProducer {
  /** Ask for one pass. Answers whether a job was enqueued. */
  enqueue(): Promise<boolean>;
  /**
   * Ask for one Opportunity. **At most one job per Opportunity waits at a
   * time**: the job's id is the Opportunity's, and BullMQ adds nothing under an
   * id it still holds — so asking a hundred times costs one recalculation.
   */
  enqueueOne(opportunityId: string): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * The producing side. The queue is built on first use, so a process that never
 * saves the configuration opens nothing.
 */
export function createValueRecalculationProducer(redis: Redis | undefined): ValueRecalculationProducer {
  let queue: Queue<ValueRecalculationJobData> | undefined;
  const open = (connection: Redis): Queue<ValueRecalculationJobData> =>
    (queue ??= new Queue<ValueRecalculationJobData>(VALUE_RECALCULATION_QUEUE, {
      connection,
      // A pass is worth nothing once it has run; a failed one is kept a
      // while for whoever looks at the queue. A failure is tried again, later:
      // nothing else is coming to do what the job was asked for.
      defaultJobOptions: {
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 100 },
        attempts: JOB_ATTEMPTS,
        backoff: JOB_BACKOFF,
      },
    }));
  return {
    async enqueue(): Promise<boolean> {
      if (redis === undefined) return false;
      await open(redis).add(VALUE_RECALCULATION_JOB, {});
      return true;
    },
    async enqueueOne(opportunityId: string): Promise<boolean> {
      if (redis === undefined) return false;
      await open(redis).add(
        VALUE_RECALCULATION_ONE_JOB,
        { opportunityId },
        // Removed the moment it ends, either way: a kept job would hold its id
        // and refuse the next request for the same Opportunity.
        { jobId: `opportunity-${opportunityId}`, removeOnComplete: true, removeOnFail: true },
      );
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
  /** One Opportunity; answers whether its figure changed. */
  readonly recalculateOne: (opportunityId: string) => Promise<boolean>;
  readonly log: PlatformLogger;
}

/**
 * The body of one job: one pass. A failure fails the job — unlike a periodic
 * tick there is no next one coming — and BullMQ runs it again after a pause,
 * {@link JOB_ATTEMPTS} times in all; its record of the last failure is the
 * only trace after that.
 */
export function valueRecalculationJob(
  deps: ValueRecalculationDeps,
): (job?: { data?: ValueRecalculationJobData }) => Promise<void> {
  return async (job) => {
    const opportunityId = job?.data?.opportunityId;
    if (opportunityId) {
      await deps.recalculateOne(opportunityId);
      return;
    }
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
    new Worker<ValueRecalculationJobData>(
      VALUE_RECALCULATION_QUEUE,
      (queued) => enterSystemScope(SCOPE_REASON, () => job(queued)),
      {
        connection: moduleQueueRedis,
        // One pass at a time per process: two at once would only contend for
        // the same rows.
        concurrency: 1,
      },
    ),
  );
  return true;
}
