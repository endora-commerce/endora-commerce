import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, rethrowIfModuleDisabled, type PlatformLogger } from '@endora-commerce/platform/kernel';
import { REQUEST_EXPIRY_SCOPE_REASON, type RequestExpiryService } from '../services/request-expiry.js';

/**
 * `specs/182-related-payers/` T083 (FR-045, FR-102) — the clock of the payer-request expiry, on
 * the `quote_requests` expiry sweep's pattern (Principle X).
 *
 * **BullMQ is the clock and nothing more.** One module-wide Job Scheduler fires every thirty
 * minutes and its job carries no data: what is due is read from the table on every tick, so a
 * flushed Redis loses a tick and never an expiry. Expiry is counted in days; half an hour of
 * lateness is not a setting anybody has asked for.
 *
 * **Off means no tick.** The consumer is attached through `ctx.worker`, which stops it with the
 * module; the tick also asks presence itself, for the job already in hand when the flip landed.
 * Nothing is lost while off: the first tick after reactivation reads every request that fell due.
 *
 * **An idle tick enters no scope**: it asks `hasExpirable` — one boolean, no tenant context — and
 * opens the system scope (and its escape-hatch record) only when something is due.
 */

export const REQUEST_EXPIRY_SWEEP_QUEUE = 'related_payers.request_expiry.sweep';
export const REQUEST_EXPIRY_SWEEP_SCHEDULER_ID = 'related_payers.request_expiry.sweep';
/** Every thirty minutes. */
export const REQUEST_EXPIRY_SWEEP_EVERY_MS = 30 * 60 * 1000;

export type RequestExpirySweepJobData = Record<string, never>;

export interface RequestExpirySweepDeps {
  readonly expiry: Pick<RequestExpiryService, 'hasExpirable' | 'sweepInScope'>;
  /** The module's effective presence, asked on every tick. */
  readonly isPresent: () => boolean;
  readonly log: PlatformLogger;
}

/**
 * One tick. A failed pass is logged and not re-thrown — the next tick is the retry and reads the
 * same rows — except a module switched off underneath, which is never swallowed
 * (module-composition item 7). A presence question that cannot be answered counts as yes.
 */
export async function runRequestExpirySweepTick(deps: RequestExpirySweepDeps): Promise<void> {
  if (!deps.isPresent()) return;
  let hasWork = true;
  try {
    hasWork = await deps.expiry.hasExpirable();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    hasWork = true;
  }
  if (!hasWork) return;
  await enterSystemScope(REQUEST_EXPIRY_SCOPE_REASON, async () => {
    try {
      const result = await deps.expiry.sweepInScope();
      if (result.expiredCount > 0 || result.skippedCount > 0) {
        deps.log.info({ ...result }, 'related_payers: request expiry sweep finished');
      }
    } catch (error) {
      rethrowIfModuleDisabled(error);
      deps.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'related_payers: the request expiry sweep failed; the next tick retries',
      );
    }
  });
}

export function createRequestExpirySweepQueue(redis: Redis, prefix?: string): Queue<RequestExpirySweepJobData> {
  return new Queue<RequestExpirySweepJobData>(REQUEST_EXPIRY_SWEEP_QUEUE, {
    connection: redis,
    ...(prefix !== undefined ? { prefix } : {}),
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

export function buildRequestExpirySweepWorker(
  deps: RequestExpirySweepDeps & { readonly redis: Redis; readonly prefix?: string },
): Worker<RequestExpirySweepJobData> {
  return new Worker<RequestExpirySweepJobData>(REQUEST_EXPIRY_SWEEP_QUEUE, () => runRequestExpirySweepTick(deps), {
    connection: deps.redis,
    concurrency: 1,
    ...(deps.prefix !== undefined ? { prefix: deps.prefix } : {}),
  });
}

/** Install the module-wide schedule; idempotent by scheduler id, so every boot calls it. */
export async function ensureRequestExpirySweepSchedule(
  queue: Pick<Queue<RequestExpirySweepJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    REQUEST_EXPIRY_SWEEP_SCHEDULER_ID,
    { every: REQUEST_EXPIRY_SWEEP_EVERY_MS },
    { name: 'sweep', data: {} },
  );
}

/**
 * Build and start the consumer where the host says this process runs one (`processRunsWorkers`)
 * and offers a connection (`moduleQueueRedis`); the shared test server says neither and drives
 * the tick directly. `attach` is `ctx.worker`. Answers whether a consumer was started.
 */
export async function startRequestExpirySweep(
  input: RequestExpirySweepDeps & {
    readonly processRunsWorkers: boolean;
    readonly moduleQueueRedis: Redis | undefined;
    readonly attach: (worker: Worker<RequestExpirySweepJobData>) => void;
    readonly onClose: (close: () => Promise<void>) => void;
    readonly queuePrefix?: string;
  },
): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis, queuePrefix } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createRequestExpirySweepQueue(moduleQueueRedis, queuePrefix);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    buildRequestExpirySweepWorker({
      redis: moduleQueueRedis,
      expiry: input.expiry,
      isPresent: input.isPresent,
      log: input.log,
      ...(queuePrefix !== undefined ? { prefix: queuePrefix } : {}),
    }),
  );
  await ensureRequestExpirySweepSchedule(queue);
  return true;
}
