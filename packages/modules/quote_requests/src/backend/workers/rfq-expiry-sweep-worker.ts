import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  enterSystemScope,
  rethrowIfModuleDisabled,
  type PlatformLogger,
} from '@endora-commerce/platform/kernel';
import type { RfqExpiryWorker } from '../services/rfq-expiry-worker.js';

/**
 * The clock for the Quote Request expiry sweep.
 *
 * `RfqExpiryWorker.sweep()` was built, exposed on the module's handle and
 * documented as running every 30 minutes — and nothing ever called it. No
 * scheduler, timer or command reached it from the day it was written, so a
 * Pending Quote Request never became `Expired`, nobody was told, and
 * `rfq.expired.v1` was announced by no instance. This file is the missing
 * caller.
 *
 * **BullMQ is the clock and nothing more.** One module-wide Job Scheduler fires
 * every thirty minutes and its job carries no data: what is due is read from
 * the table on every tick, so a flushed Redis loses a tick and never an expiry.
 * A scheduler rather than a `setInterval` for the reason every periodic job
 * here is — Principle X keeps timers out of the API process, and a Redis-held
 * schedule survives a deploy.
 *
 * **More than one consumer is fine.** Each request is expired in a transaction
 * of its own, read `for update skip locked`, so two worker processes sweeping
 * at once split the requests between them.
 *
 * **An idle tick enters no scope.** The tick first asks
 * `RfqExpiryWorker.hasExpirable()` — one boolean, read with no tenant context —
 * and opens the system scope only when the answer is yes, so an instance with
 * nothing to expire writes no `tenant.escape_hatch` audit row every half hour.
 *
 * The interval is a constant, not a setting: expiry is counted in days, and
 * half an hour of lateness is not something anybody has asked to tune.
 */

export const RFQ_EXPIRY_SWEEP_QUEUE = 'quote_requests.expiry.sweep';
export const RFQ_EXPIRY_SWEEP_SCHEDULER_ID = 'quote_requests.expiry.sweep';
/** Every thirty minutes. */
export const RFQ_EXPIRY_SWEEP_EVERY_MS = 30 * 60 * 1000;

export type RfqExpirySweepJobData = Record<string, never>;

export interface RfqExpirySweepDeps {
  readonly expiry: Pick<RfqExpiryWorker, 'hasExpirable' | 'sweepInScope'>;
  readonly log: PlatformLogger;
}

export const RFQ_EXPIRY_SWEEP_SCOPE_REASON = 'quote_requests: expire overdue quote requests';

/**
 * The body of one pass, inside the scope.
 *
 * A failed pass is logged and **not** re-thrown. Failing the job would buy
 * nothing — the next tick is the retry, and it re-reads the same rows. The
 * exception is a module switched off underneath the pass: that is never
 * swallowed (module-composition item 7) and fails this one job.
 */
function sweepTick(deps: RfqExpirySweepDeps): () => Promise<void> {
  return async () => {
    try {
      const result = await deps.expiry.sweepInScope();
      if (result.expiredCount > 0 || result.failedCount > 0) {
        deps.log.info(
          { ...result },
          'quote_requests: expiry sweep finished' +
            (result.reachedBatchLimit ? '; more are due and the next tick continues' : ''),
        );
      }
    } catch (error) {
      rethrowIfModuleDisabled(error);
      deps.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'quote_requests: the expiry sweep failed; the next tick retries',
      );
    }
  };
}

/**
 * What BullMQ invokes for one job: ask whether anything is due, and open the
 * system scope only when something is.
 *
 * Entering the scope is what writes the `tenant.escape_hatch` audit record, so
 * a scope entered on every tick is one audit row every half hour on an
 * instance where nothing happened: a record of access that read nobody's data.
 *
 * **The question is asked outside any scope and answers yes or no, nothing
 * else** (`RfqExpiryWorker.hasExpirable`). Everything a pass reads or writes
 * is read inside the scope, by the pass itself — the answer here decides only
 * *whether* the scope is entered, and is never handed to the pass.
 *
 * **A question that cannot be answered counts as yes.** The tick then runs
 * with its scope and its audit record: a failing probe may cost an audit row,
 * and can never save one. A module switched off is the one thing that is not a
 * failed question, and is never absorbed.
 */
export async function runRfqExpirySweepTick(deps: RfqExpirySweepDeps): Promise<void> {
  let hasWork = true;
  try {
    hasWork = await deps.expiry.hasExpirable();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    hasWork = true;
  }
  if (!hasWork) return;
  await enterSystemScope(RFQ_EXPIRY_SWEEP_SCOPE_REASON, sweepTick(deps));
}

export function createRfqExpirySweepQueue(redis: Redis, prefix?: string): Queue<RfqExpirySweepJobData> {
  return new Queue<RfqExpirySweepJobData>(RFQ_EXPIRY_SWEEP_QUEUE, {
    connection: redis,
    ...(prefix !== undefined ? { prefix } : {}),
    // A tick is worth nothing once it has run: keep a short tail for an
    // operator looking at the queue, and no history beyond it.
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

export function buildRfqExpirySweepWorker(
  deps: RfqExpirySweepDeps & { readonly redis: Redis; readonly prefix?: string },
): Worker<RfqExpirySweepJobData> {
  // One tick at a time per process: a second concurrent pass in the same
  // process would only skip the requests the first holds.
  return new Worker<RfqExpirySweepJobData>(
    RFQ_EXPIRY_SWEEP_QUEUE,
    // The scope is opened one call down, in `runRfqExpirySweepTick` — the
    // function this site has no caller for — and only for a tick that has
    // something to do.
    () => runRfqExpirySweepTick(deps),
    {
      connection: deps.redis,
      concurrency: 1,
      ...(deps.prefix !== undefined ? { prefix: deps.prefix } : {}),
    },
  );
}

/**
 * Install the module-wide schedule. Idempotent by scheduler id, so it is safe
 * to call on every boot of every worker process — which is how it is called.
 */
export async function ensureRfqExpirySweepSchedule(
  queue: Pick<Queue<RfqExpirySweepJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    RFQ_EXPIRY_SWEEP_SCHEDULER_ID,
    { every: RFQ_EXPIRY_SWEEP_EVERY_MS },
    { name: 'sweep', data: {} },
  );
}

/**
 * Build and start the consumer — where the host says this process runs one.
 *
 * The whole decision in one function so it can be tested without Redis: a
 * consumer is built only when the process consumes queues (`processRunsWorkers`)
 * **and** the composition offers a connection to build one on
 * (`moduleQueueRedis`). The shared test server says neither, and drives
 * `sweep()` directly.
 *
 * `attach` is the platform's worker seam — `ctx.worker` — which is what puts
 * the consumer in the registry the platform reconciles and stops, so a
 * switched-off module runs no tick; `onClose` registers the queue's own
 * shutdown. `queuePrefix` is BullMQ's key prefix and is left alone in
 * production: a test that shares a Redis with other runs sets one of its own.
 * Answers whether a consumer was started.
 */
export async function startRfqExpirySweep(
  input: RfqExpirySweepDeps & {
    readonly processRunsWorkers: boolean;
    readonly moduleQueueRedis: Redis | undefined;
    readonly attach: (worker: Worker<RfqExpirySweepJobData>) => void;
    readonly onClose: (close: () => Promise<void>) => void;
    readonly queuePrefix?: string;
  },
): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis, queuePrefix } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createRfqExpirySweepQueue(moduleQueueRedis, queuePrefix);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    buildRfqExpirySweepWorker({
      redis: moduleQueueRedis,
      expiry: input.expiry,
      log: input.log,
      ...(queuePrefix !== undefined ? { prefix: queuePrefix } : {}),
    }),
  );
  await ensureRfqExpirySweepSchedule(queue);
  return true;
}
