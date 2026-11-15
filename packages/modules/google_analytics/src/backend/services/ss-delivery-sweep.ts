import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { rethrowIfModuleDisabled, type PlatformLogger } from '@endora-commerce/platform/kernel';
import { GA_DELIVERY_KEEP_COMPLETED, GA_DELIVERY_KEEP_FAILED } from './ss-delivery-queue.js';

/**
 * The clock that empties a quiet `google_analytics.ss.deliver` queue (issue
 * #1248), on the webhooks delivery-retention tick's pattern (#1003).
 *
 * A delivery job carries the visitor's `clientId` and the event's `params`.
 * The queue's default job options bound a finished job by age, but BullMQ
 * applies that age only when another job finishes in the same set, so on an
 * instance where no event arrives the last jobs would stay in Redis
 * indefinitely. Once an hour this removes the delivered and the failed jobs
 * past their bounds, whatever the traffic.
 *
 * **BullMQ is the clock and nothing more.** One module-wide Job Scheduler,
 * under a stable id, fires every hour and its job carries no data; upserting it
 * by that id is idempotent, so every boot of every worker process installs the
 * same schedule, and two consumers cleaning at once remove each job once.
 *
 * **No tick enters a system scope**: it touches no table, only the queue.
 */

export const GA_DELIVERY_SWEEP_QUEUE = 'google_analytics.ss.deliver.sweep';
export const GA_DELIVERY_SWEEP_SCHEDULER_ID = 'google_analytics.ss.deliver.sweep';
/** Every hour: the shortest bound is an hour. */
export const GA_DELIVERY_SWEEP_EVERY_MS = 60 * 60 * 1000;

export type GaDeliverySweepJobData = Record<string, never>;

export interface GaDeliverySweepDeps {
  /** The `google_analytics.ss.deliver` queue the module's producer writes to. */
  readonly deliveryQueue: Pick<Queue, 'clean'>;
  readonly log: PlatformLogger;
}

/**
 * Remove the delivered jobs older than {@link GA_DELIVERY_KEEP_COMPLETED} and
 * the failed ones older than {@link GA_DELIVERY_KEEP_FAILED}, and answer how
 * many went. A limit of 0 is unlimited; BullMQ removes in batches.
 */
export async function sweepFinishedGaDeliveryJobs(queue: Pick<Queue, 'clean'>): Promise<number> {
  const completed = await queue.clean(GA_DELIVERY_KEEP_COMPLETED.age * 1000, 0, 'completed');
  const failed = await queue.clean(GA_DELIVERY_KEEP_FAILED.age * 1000, 0, 'failed');
  return completed.length + failed.length;
}

/**
 * One tick: one sweep. A failed sweep is logged and re-thrown, so the tick is
 * recorded as failed; the next tick is the retry. A module switched off
 * underneath the tick is re-thrown as it is (module-composition item 7).
 */
export async function runGaDeliverySweepTick(deps: GaDeliverySweepDeps): Promise<void> {
  try {
    const jobsRemoved = await sweepFinishedGaDeliveryJobs(deps.deliveryQueue);
    if (jobsRemoved > 0) {
      deps.log.info({ jobsRemoved }, 'google_analytics: finished delivery jobs past their bound removed');
    }
  } catch (error) {
    rethrowIfModuleDisabled(error);
    deps.log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'google_analytics: the delivery job sweep failed; the next tick retries',
    );
    throw error;
  }
}

export function createGaDeliverySweepQueue(redis: Redis, prefix?: string): Queue<GaDeliverySweepJobData> {
  return new Queue<GaDeliverySweepJobData>(GA_DELIVERY_SWEEP_QUEUE, {
    connection: redis,
    ...(prefix !== undefined ? { prefix } : {}),
    // A tick is worth nothing once it has run, and carries no data: a short
    // tail for an operator.
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

export function buildGaDeliverySweepWorker(
  deps: GaDeliverySweepDeps & { readonly redis: Redis; readonly prefix?: string },
): Worker<GaDeliverySweepJobData> {
  return new Worker<GaDeliverySweepJobData>(GA_DELIVERY_SWEEP_QUEUE, () => runGaDeliverySweepTick(deps), {
    connection: deps.redis,
    concurrency: 1,
    ...(deps.prefix !== undefined ? { prefix: deps.prefix } : {}),
  });
}

/** Install the module-wide schedule. Idempotent by scheduler id. */
export async function ensureGaDeliverySweepSchedule(
  queue: Pick<Queue<GaDeliverySweepJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    GA_DELIVERY_SWEEP_SCHEDULER_ID,
    { every: GA_DELIVERY_SWEEP_EVERY_MS },
    { name: 'sweep', data: {} },
  );
}

/**
 * Build and start the sweep consumer, and install its schedule. The caller
 * decides where — the module calls it where it runs the delivery consumer.
 * `attach` is the platform's worker seam (`ctx.worker`), so while
 * `google_analytics` is off no tick runs, and the first tick after it is back
 * removes what expired meanwhile; `onClose` registers the queue's own
 * shutdown. `queuePrefix` is for a test sharing a Redis.
 */
export async function startGaDeliverySweep(
  input: GaDeliverySweepDeps & {
    readonly redis: Redis;
    readonly attach: (worker: Worker<GaDeliverySweepJobData>) => void;
    readonly onClose: (close: () => Promise<void>) => void;
    readonly queuePrefix?: string;
  },
): Promise<void> {
  const { redis, queuePrefix } = input;
  const queue = createGaDeliverySweepQueue(redis, queuePrefix);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    buildGaDeliverySweepWorker({
      redis,
      deliveryQueue: input.deliveryQueue,
      log: input.log,
      ...(queuePrefix !== undefined ? { prefix: queuePrefix } : {}),
    }),
  );
  await ensureGaDeliverySweepSchedule(queue);
}
