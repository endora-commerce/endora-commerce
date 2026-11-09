import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { rethrowIfModuleDisabled, type PlatformLogger } from '@endora-commerce/platform/kernel';
import type { WebhookDeliveryRetentionService } from './delivery-retention.js';

/**
 * The clock of the delivery-history retention window (issue #928), on the
 * customers anonymisation sweep's pattern (issue #677).
 *
 * **BullMQ is the clock and nothing more.** One module-wide Job Scheduler,
 * under a stable id, fires once a day and its job carries no data: what is past
 * the window is read from the table on every tick, so a flushed Redis loses a
 * tick and never a deletion. Upserting it by that id is idempotent, so every
 * boot of every worker process installs the same one schedule, and a tick that
 * two consumers run at once deletes each row once.
 *
 * **No tick enters a system scope**, so none needs a probe before it:
 * `WebhookDelivery` is `@GlobalEntity()`, which the tenancy guard does not
 * filter, as the assets retention sweep's tables are.
 */

export const WEBHOOK_DELIVERY_RETENTION_QUEUE = 'webhooks.delivery-retention';
export const WEBHOOK_DELIVERY_RETENTION_SCHEDULER_ID = 'webhooks.delivery-retention';
/** Once a day: the window is counted in days. */
export const WEBHOOK_DELIVERY_RETENTION_EVERY_MS = 24 * 60 * 60 * 1000;

export type WebhookDeliveryRetentionJobData = Record<string, never>;

export interface WebhookDeliveryRetentionDeps {
  readonly retention: Pick<WebhookDeliveryRetentionService, 'purge'>;
  readonly log: PlatformLogger;
}

/**
 * One tick: one purge. A failed purge is logged and re-thrown, so the job is
 * recorded as failed; the next tick is the retry. A module switched off
 * underneath the tick is re-thrown as it is (module-composition item 7).
 */
export async function runWebhookDeliveryRetentionTick(deps: WebhookDeliveryRetentionDeps): Promise<void> {
  try {
    const { retentionDays, deleted } = await deps.retention.purge();
    if (deleted > 0) {
      deps.log.info({ retentionDays, deleted }, 'webhooks: delivery history past the retention window deleted');
    }
  } catch (error) {
    rethrowIfModuleDisabled(error);
    deps.log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'webhooks: the delivery retention purge failed; the next tick retries',
    );
    throw error;
  }
}

export function createWebhookDeliveryRetentionQueue(
  redis: Redis,
  prefix?: string,
): Queue<WebhookDeliveryRetentionJobData> {
  return new Queue<WebhookDeliveryRetentionJobData>(WEBHOOK_DELIVERY_RETENTION_QUEUE, {
    connection: redis,
    ...(prefix !== undefined ? { prefix } : {}),
    // A tick is worth nothing once it has run: a short tail for an operator.
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

export function buildWebhookDeliveryRetentionWorker(
  deps: WebhookDeliveryRetentionDeps & { readonly redis: Redis; readonly prefix?: string },
): Worker<WebhookDeliveryRetentionJobData> {
  return new Worker<WebhookDeliveryRetentionJobData>(
    WEBHOOK_DELIVERY_RETENTION_QUEUE,
    () => runWebhookDeliveryRetentionTick(deps),
    {
      connection: deps.redis,
      concurrency: 1,
      ...(deps.prefix !== undefined ? { prefix: deps.prefix } : {}),
    },
  );
}

/** Install the module-wide schedule. Idempotent by scheduler id. */
export async function ensureWebhookDeliveryRetentionSchedule(
  queue: Pick<Queue<WebhookDeliveryRetentionJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    WEBHOOK_DELIVERY_RETENTION_SCHEDULER_ID,
    { every: WEBHOOK_DELIVERY_RETENTION_EVERY_MS },
    { name: 'purge', data: {} },
  );
}

/**
 * Build and start the consumer where this composition runs the module's
 * workers (`webhooksRunWorkers`, the flag the delivery consumer already
 * follows). `attach` is the platform's worker seam — `ctx.worker` — so while
 * `webhooks` is switched off no tick runs; `onClose` registers the queue's own
 * shutdown. `queuePrefix` is for a test sharing a Redis. Answers whether a
 * consumer was started.
 */
export async function startWebhookDeliveryRetention(
  input: WebhookDeliveryRetentionDeps & {
    readonly runWorkers: boolean;
    readonly redis: Redis | undefined;
    readonly attach: (worker: Worker<WebhookDeliveryRetentionJobData>) => void;
    readonly onClose: (close: () => Promise<void>) => void;
    readonly queuePrefix?: string;
  },
): Promise<boolean> {
  const { runWorkers, redis, queuePrefix } = input;
  if (!runWorkers || redis === undefined) return false;
  const queue = createWebhookDeliveryRetentionQueue(redis, queuePrefix);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    buildWebhookDeliveryRetentionWorker({
      redis,
      retention: input.retention,
      log: input.log,
      ...(queuePrefix !== undefined ? { prefix: queuePrefix } : {}),
    }),
  );
  await ensureWebhookDeliveryRetentionSchedule(queue);
  return true;
}
