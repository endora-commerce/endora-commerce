import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  enterSystemScope,
  rethrowIfModuleDisabled,
  type PlatformLogger,
} from '@endora-commerce/platform/kernel';
import type { CustomerDeletionService } from '../services/customer-deletion-service.js';

/**
 * AnonymizationSweepWorker — repeatable job that permanently anonymizes
 * soft-deleted customer accounts once their retention window has elapsed
 * (feature 040, US7 / FR-040). Mirrors the carts abandonment-sweep pattern:
 * a thin class exposing `sweep()`, driven by the Job Scheduler below. Returns
 * the number of accounts anonymized.
 */
export class AnonymizationSweepWorker {
  constructor(
    private readonly deletion: CustomerDeletionService,
    private readonly resolveRetentionDays: () => Promise<number>,
  ) {}

  /**
   * The tick's question before its scope (issue #857). The retention setting is
   * platform-wide configuration, not an Organization's data, so it is read here
   * outside any scope; the sweep reads it again inside its own.
   */
  async hasDue(now: Date = new Date()): Promise<boolean> {
    const retentionDays = await this.resolveRetentionDays();
    return this.deletion.hasDue(retentionDays, now);
  }

  async sweep(now: Date = new Date()): Promise<number> {
    const retentionDays = await this.resolveRetentionDays();
    return this.deletion.sweep(retentionDays, now);
  }
}

/**
 * The clock for the retention sweep (issue #677).
 *
 * `AnonymizationSweepWorker.sweep()` was built, exposed on the module's handle
 * and documented as what scrubs a deleted account once
 * `customers.deletion_retention_days` has elapsed — and nothing ever called
 * it, so a deleted account kept its personal data indefinitely and
 * `customer_account.anonymized.v1` was announced by no instance. What follows
 * is the missing caller, on the `quote_requests` expiry sweep's pattern.
 *
 * **BullMQ is the clock and nothing more.** One module-wide Job Scheduler, under
 * a stable id, fires once a day and its job carries no data: what is due is
 * read from the table on every tick, so a flushed Redis loses a tick and never
 * an anonymization. Upserting it by that id is idempotent, so every boot of
 * every worker process installs the same one schedule. The sweep is restartable
 * (issue #800), so a tick that two consumers happen to run at once converges.
 *
 * The interval is a constant, not a setting: the retention window is counted
 * in days, on a 365-day default.
 */

export const ANONYMIZATION_SWEEP_QUEUE = 'customers.anonymization.sweep';
export const ANONYMIZATION_SWEEP_SCHEDULER_ID = 'customers.anonymization.sweep';
/** Once a day. */
export const ANONYMIZATION_SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

export const ANONYMIZATION_SWEEP_SCOPE_REASON =
  'customers: anonymize soft-deleted accounts past the retention window';

export type AnonymizationSweepJobData = Record<string, never>;

export interface AnonymizationSweepDeps {
  readonly sweeper: Pick<AnonymizationSweepWorker, 'hasDue' | 'sweep'>;
  readonly log: PlatformLogger;
}

/**
 * What BullMQ invokes for one job: ask whether any account is due, and only
 * then one sweep, in the system scope — the accounts due are every tenant's.
 *
 * **An idle tick enters no scope** (issue #857). Entering the scope is what
 * writes the `tenant.escape_hatch` audit row, so the question is asked first,
 * outside any scope, and answers yes or no and nothing else
 * (`AnonymizationSweepWorker.hasDue`). The answer decides only *whether* the
 * scope is entered; the sweep re-reads its work list inside it. A question that
 * cannot be answered counts as yes, so a failing probe may cost an audit row
 * and can never skip an anonymization. A module switched off is not a failed
 * question and is re-thrown.
 *
 * A failed sweep is logged and **re-thrown**, so the job is recorded as failed:
 * `CustomerDeletionService.sweep` anonymizes every account it can and then
 * throws once, naming the ids that failed, for exactly that purpose. The job is
 * not retried; the next tick is the retry, and the failed accounts are still
 * due. A module switched off underneath the sweep is re-thrown as it is
 * (module-composition item 7).
 */
export async function runAnonymizationSweepTick(deps: AnonymizationSweepDeps): Promise<void> {
  let hasWork = true;
  try {
    hasWork = await deps.sweeper.hasDue();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    hasWork = true;
  }
  if (!hasWork) return;
  try {
    const anonymized = await enterSystemScope(ANONYMIZATION_SWEEP_SCOPE_REASON, () => deps.sweeper.sweep());
    if (anonymized > 0) {
      deps.log.info({ anonymized }, 'customers: anonymization sweep finished');
    }
  } catch (error) {
    rethrowIfModuleDisabled(error);
    deps.log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'customers: the anonymization sweep failed; the next tick retries',
    );
    throw error;
  }
}

export function createAnonymizationSweepQueue(redis: Redis, prefix?: string): Queue<AnonymizationSweepJobData> {
  return new Queue<AnonymizationSweepJobData>(ANONYMIZATION_SWEEP_QUEUE, {
    connection: redis,
    ...(prefix !== undefined ? { prefix } : {}),
    // A tick is worth nothing once it has run: keep a short tail for an
    // operator looking at the queue, and no history beyond it.
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

export function buildAnonymizationSweepWorker(
  deps: AnonymizationSweepDeps & { readonly redis: Redis; readonly prefix?: string },
): Worker<AnonymizationSweepJobData> {
  // One tick at a time per process.
  return new Worker<AnonymizationSweepJobData>(ANONYMIZATION_SWEEP_QUEUE, () => runAnonymizationSweepTick(deps), {
    connection: deps.redis,
    concurrency: 1,
    ...(deps.prefix !== undefined ? { prefix: deps.prefix } : {}),
  });
}

/**
 * Install the module-wide schedule. Idempotent by scheduler id, so it is safe
 * to call on every boot of every worker process — which is how it is called.
 */
export async function ensureAnonymizationSweepSchedule(
  queue: Pick<Queue<AnonymizationSweepJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    ANONYMIZATION_SWEEP_SCHEDULER_ID,
    { every: ANONYMIZATION_SWEEP_EVERY_MS },
    { name: 'sweep', data: {} },
  );
}

/**
 * Build and start the consumer — where the host says this process runs one.
 *
 * A consumer is built only when the process consumes queues
 * (`processRunsWorkers`) **and** the composition offers a connection to build
 * one on (`moduleQueueRedis`). The shared test server says neither, and drives
 * `sweep()` directly.
 *
 * `attach` is the platform's worker seam — `ctx.worker` — which is what puts
 * the consumer in the registry the platform reconciles and stops, so while
 * `customers` is switched off no tick runs; `onClose` registers the queue's own
 * shutdown. `queuePrefix` is BullMQ's key prefix and is left alone in
 * production: a test that shares a Redis with other runs sets one of its own.
 * Answers whether a consumer was started.
 */
export async function startAnonymizationSweep(
  input: AnonymizationSweepDeps & {
    readonly processRunsWorkers: boolean;
    readonly moduleQueueRedis: Redis | undefined;
    readonly attach: (worker: Worker<AnonymizationSweepJobData>) => void;
    readonly onClose: (close: () => Promise<void>) => void;
    readonly queuePrefix?: string;
  },
): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis, queuePrefix } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createAnonymizationSweepQueue(moduleQueueRedis, queuePrefix);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    buildAnonymizationSweepWorker({
      redis: moduleQueueRedis,
      sweeper: input.sweeper,
      log: input.log,
      ...(queuePrefix !== undefined ? { prefix: queuePrefix } : {}),
    }),
  );
  await ensureAnonymizationSweepSchedule(queue);
  return true;
}
