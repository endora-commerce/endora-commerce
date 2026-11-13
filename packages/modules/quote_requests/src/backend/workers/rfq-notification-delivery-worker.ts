import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  enterSystemScope,
  rethrowIfModuleDisabled,
  type PlatformLogger,
} from '@endora-commerce/platform/kernel';
import { RFQ_NOTIFICATION_DELIVERY_QUEUE } from '../services/notifications/kick.js';
import type { RfqNotificationDeliveryService } from '../services/notifications/delivery-service.js';

/**
 * The clock of quote request notification delivery —
 * `specs/179-rfq-and-customer-notifications/` FR-010, research R-8,
 * `contracts/delivery-and-ports.md` §3. The expiry sweep's pattern
 * (`rfq-expiry-sweep-worker.ts`), unchanged.
 *
 * **BullMQ is the clock and nothing more; the table is the queue.** Two things
 * start a tick on the one queue the kick names (`services/notifications/kick.ts`,
 * which owns the name): a Job Scheduler every minute, and the kick a writer
 * adds after its transition commits. Neither job carries data — what is due is
 * read from `quote_request_notifications` on every tick — so a flushed Redis
 * loses a tick and never a record, and the scheduled tick catches anything a
 * lost kick missed.
 *
 * **More than one consumer is fine.** Each record is delivered in a
 * transaction of its own, read `for update skip locked`, so two worker
 * processes split the records between them. One tick at a time per process.
 *
 * **An idle tick enters no scope.** The tick first asks
 * `RfqNotificationDeliveryService.hasDeliverable()` — one boolean, read with
 * no tenant context — and opens the system scope only when the answer is yes,
 * so an instance with nothing to tell anybody writes no `tenant.escape_hatch`
 * audit row every minute.
 */

export const RFQ_NOTIFICATION_DELIVERY_SCHEDULER_ID = 'quote_requests.notifications.deliver';
/** Every minute: SC-001's two minutes with the kick missed. */
export const RFQ_NOTIFICATION_DELIVERY_EVERY_MS = 60 * 1000;
export const RFQ_NOTIFICATION_DELIVERY_SCOPE_REASON = 'quote_requests: deliver quote request notifications';

export type RfqNotificationDeliveryJobData = Record<string, never>;

export interface RfqNotificationDeliveryTickDeps {
  readonly delivery: Pick<RfqNotificationDeliveryService, 'hasDeliverable' | 'deliverInScope'>;
  readonly log: PlatformLogger;
}

/**
 * The body of one pass, inside the scope. A failed pass is logged and not
 * re-thrown — the next tick is the retry and re-reads the same records — except
 * a module switched off underneath it, which fails this one job.
 */
function deliveryPass(deps: RfqNotificationDeliveryTickDeps): () => Promise<void> {
  return async () => {
    try {
      const result = await deps.delivery.deliverInScope();
      if (result.claimed > 0) {
        deps.log.info(
          { ...result },
          'quote_requests: notification delivery pass finished' +
            (result.reachedBatchLimit ? '; more are due and the next tick continues' : ''),
        );
      }
    } catch (error) {
      rethrowIfModuleDisabled(error);
      deps.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'quote_requests: the notification delivery pass failed; the next tick retries',
      );
    }
  };
}

/**
 * What BullMQ invokes for one job, kick or schedule alike: ask whether anything
 * is due, outside any scope, and open the system scope only when something is.
 * A question that cannot be answered counts as yes; a module switched off is
 * not a failed question and is never absorbed.
 */
export async function runRfqNotificationDeliveryTick(deps: RfqNotificationDeliveryTickDeps): Promise<void> {
  let hasWork = true;
  try {
    hasWork = await deps.delivery.hasDeliverable();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    hasWork = true;
  }
  if (!hasWork) return;
  await enterSystemScope(RFQ_NOTIFICATION_DELIVERY_SCOPE_REASON, deliveryPass(deps));
}

export function createRfqNotificationDeliveryQueue(redis: Redis, prefix?: string): Queue<RfqNotificationDeliveryJobData> {
  return new Queue<RfqNotificationDeliveryJobData>(RFQ_NOTIFICATION_DELIVERY_QUEUE, {
    connection: redis,
    ...(prefix !== undefined ? { prefix } : {}),
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

export function buildRfqNotificationDeliveryWorker(
  deps: RfqNotificationDeliveryTickDeps & { readonly redis: Redis; readonly prefix?: string },
): Worker<RfqNotificationDeliveryJobData> {
  return new Worker<RfqNotificationDeliveryJobData>(
    RFQ_NOTIFICATION_DELIVERY_QUEUE,
    // The scope is opened one call down, and only for a tick with work.
    () => runRfqNotificationDeliveryTick(deps),
    {
      connection: deps.redis,
      concurrency: 1,
      ...(deps.prefix !== undefined ? { prefix: deps.prefix } : {}),
    },
  );
}

/** Install the module-wide schedule. Idempotent by scheduler id: called on every worker process's boot. */
export async function ensureRfqNotificationDeliverySchedule(
  queue: Pick<Queue<RfqNotificationDeliveryJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    RFQ_NOTIFICATION_DELIVERY_SCHEDULER_ID,
    { every: RFQ_NOTIFICATION_DELIVERY_EVERY_MS },
    { name: 'deliver', data: {} },
  );
}

/**
 * Build and start the consumer where the host says this process runs one —
 * it consumes queues (`processRunsWorkers`) **and** the composition offers a
 * connection (`moduleQueueRedis`). The shared test server says neither, and
 * drives `deliverInScope()` directly.
 *
 * `attach` is `ctx.worker`, which puts the consumer in the registry the
 * platform reconciles and stops: while `quote_requests` is off no tick runs
 * and the records wait, `pending`, for it to come back. Answers whether a
 * consumer was started.
 */
export async function startRfqNotificationDelivery(
  input: RfqNotificationDeliveryTickDeps & {
    readonly processRunsWorkers: boolean;
    readonly moduleQueueRedis: Redis | undefined;
    readonly attach: (worker: Worker<RfqNotificationDeliveryJobData>) => void;
    readonly onClose: (close: () => Promise<void>) => void;
    readonly queuePrefix?: string;
  },
): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis, queuePrefix } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createRfqNotificationDeliveryQueue(moduleQueueRedis, queuePrefix);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    buildRfqNotificationDeliveryWorker({
      redis: moduleQueueRedis,
      delivery: input.delivery,
      log: input.log,
      ...(queuePrefix !== undefined ? { prefix: queuePrefix } : {}),
    }),
  );
  await ensureRfqNotificationDeliverySchedule(queue);
  return true;
}
