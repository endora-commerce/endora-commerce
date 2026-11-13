import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, rethrowIfModuleDisabled, type PlatformLogger } from '@endora-commerce/platform/kernel';
import type { RetentionSweepResult } from '../services/retention-sweeper.js';

/**
 * The clock of the centre's retention sweep
 * (`specs/179-rfq-and-customer-notifications/` research R-16), shaped after
 * `quote_requests`' expiry sweep.
 *
 * **BullMQ is the clock and nothing more.** One module-wide Job Scheduler fires
 * once a day and its job carries no data: what is due is read from the table on
 * every tick, so a flushed Redis loses a tick and never a deletion, and a
 * changed retention period has no queue to keep in step.
 *
 * **An idle tick enters no scope.** The tick asks one yes-or-no question
 * outside any tenant scope and enters the system scope — whose entry writes the
 * `tenant.escape_hatch` audit row — only when the answer is yes.
 *
 * **Presence is decided first**, outside every `try` (Constitution XVII): a
 * tick taken while the module is off reads nothing, and nothing is lost — the
 * first tick after the module is back finds everything that became due.
 */

export const CUSTOMER_NOTIFICATIONS_RETENTION_QUEUE = 'customer_notifications.retention.sweep';
export const CUSTOMER_NOTIFICATIONS_RETENTION_SCHEDULER_ID = 'customer_notifications.retention.sweep';
/** Once a day. */
export const CUSTOMER_NOTIFICATIONS_RETENTION_EVERY_MS = 24 * 60 * 60 * 1000;
export const CUSTOMER_NOTIFICATIONS_RETENTION_SCOPE_REASON =
  'customer_notifications: delete notifications past their retention period and those of deleted accounts';

export type RetentionSweepJobData = Record<string, never>;

export interface RetentionSweepDeps {
  /** Whether this module is present — the platform's one answer, on both axes. */
  readonly isPresent: () => boolean;
  readonly sweeper: {
    hasWork(): Promise<boolean>;
    sweep(now: Date): Promise<RetentionSweepResult>;
  };
  readonly log: Pick<PlatformLogger, 'info' | 'warn'>;
  /** The tick's clock; tests pin it. */
  readonly now?: () => Date;
}

/**
 * One tick. A question that cannot be answered counts as yes; a failed pass is
 * logged and not re-thrown — the next tick is the retry. A module switched off
 * underneath either is never absorbed (module-composition item 7).
 */
export async function runRetentionSweepTick(deps: RetentionSweepDeps): Promise<void> {
  if (!deps.isPresent()) return;
  let hasWork = true;
  try {
    hasWork = await deps.sweeper.hasWork();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    hasWork = true;
  }
  if (!hasWork) return;
  const now = deps.now?.() ?? new Date();
  await enterSystemScope(CUSTOMER_NOTIFICATIONS_RETENTION_SCOPE_REASON, async () => {
    try {
      const result = await deps.sweeper.sweep(now);
      deps.log.info({ ...result }, 'customer_notifications: retention sweep finished');
    } catch (error) {
      rethrowIfModuleDisabled(error);
      deps.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'customer_notifications: the retention sweep failed; the next tick retries',
      );
    }
  });
}

export function createRetentionSweepQueue(redis: Redis): Queue<RetentionSweepJobData> {
  return new Queue<RetentionSweepJobData>(CUSTOMER_NOTIFICATIONS_RETENTION_QUEUE, {
    connection: redis,
    // A tick is worth nothing once it has run: a short tail, and no history beyond it.
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

/** Install the module-wide schedule. Idempotent by scheduler id, so safe on every boot of every worker process. */
export async function ensureRetentionSweepSchedule(
  queue: Pick<Queue<RetentionSweepJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    CUSTOMER_NOTIFICATIONS_RETENTION_SCHEDULER_ID,
    { every: CUSTOMER_NOTIFICATIONS_RETENTION_EVERY_MS },
    { name: 'sweep', data: {} },
  );
}

/**
 * Build and start the consumer where the host says this process runs one: only
 * when it consumes queues (`processRunsWorkers`) **and** the composition offers
 * a connection (`moduleQueueRedis`). The shared test server says neither and
 * drives {@link runRetentionSweepTick} directly. `attach` is `ctx.worker`,
 * which stops the consumer with the module. Answers whether one was started.
 */
export async function startRetentionSweep(input: {
  readonly deps: RetentionSweepDeps;
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly attach: (worker: Worker<RetentionSweepJobData>) => void;
  readonly onClose: (close: () => Promise<void>) => void;
}): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createRetentionSweepQueue(moduleQueueRedis);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    // One tick at a time per process: a second concurrent pass would only find the first's work done.
    new Worker<RetentionSweepJobData>(
      CUSTOMER_NOTIFICATIONS_RETENTION_QUEUE,
      () => runRetentionSweepTick(input.deps),
      { connection: moduleQueueRedis, concurrency: 1 },
    ),
  );
  await ensureRetentionSweepSchedule(queue);
  return true;
}
