import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { PlatformLogger } from '../../kernel/logging.js';
import { enterSystemScope } from '../../kernel/scope.js';
import { COMMAND_OUTBOX_DRAIN_EVERY_MS, COMMAND_OUTBOX_DRAIN_QUEUE, COMMAND_OUTBOX_DRAIN_SCHEDULER_ID } from './constants.js';
import { drainCommandOutbox, type OutboxHandlerLookup } from './drain.js';
import type { OutboxStore } from './store.js';

/**
 * The clock of the command outbox drain (`specs/176-command-hooks-outbox/`
 * FR-033, research R-17/R-18) — the `quote_requests` expiry sweep's shape
 * (`rfq-expiry-sweep-worker.ts`), Principle X.
 *
 * **BullMQ is the clock and nothing more.** One job scheduler ticks every ten
 * seconds, and a commit that wrote rows enqueues one deduplicated wake-up on
 * the same queue (`./wake.ts`); neither job carries data. What is due is read
 * from `command_outbox` on every tick, so a flushed Redis loses a tick and
 * never a delivery.
 *
 * **More than one consumer is fine.** A claim is `for update skip locked` and
 * commits before any handler runs, so two worker processes split the rows.
 * One tick at a time per process.
 *
 * **An idle tick enters no scope.** It asks the store one boolean with no
 * tenant context and opens the system scope — whose entry writes the
 * `tenant.escape_hatch` record — only when there is something to do. An
 * answer that cannot be had counts as yes.
 *
 * Attached by `_lifecycle` through `ctx.worker`, built only where the host says
 * this process consumes queues (`processRunsWorkers`) and offers a connection
 * (`moduleQueueRedis`). The shared test server says neither, and a test drives
 * {@link runCommandOutboxDrainTick} directly.
 */

export type CommandOutboxDrainJobData = Record<string, never>;

export const COMMAND_OUTBOX_DRAIN_SCOPE_REASON = 'command_outbox: drain';

export interface CommandOutboxDrainTickDeps {
  readonly store: OutboxStore;
  readonly handlers: OutboxHandlerLookup;
  readonly log: PlatformLogger;
  readonly now?: () => Date;
  /** The scope a non-idle tick runs in; the platform system scope unless a test supplies one. */
  readonly enterScope?: (reason: string, run: () => Promise<void>) => Promise<unknown>;
}

/**
 * One tick: ask whether anything is due, and only then open one system scope
 * and drain. A failed pass is logged and not re-thrown — the next tick is the
 * retry, and it reads the same rows.
 */
export async function runCommandOutboxDrainTick(deps: CommandOutboxDrainTickDeps): Promise<void> {
  const now = deps.now ?? ((): Date => new Date());
  let hasWork = true;
  try {
    hasWork = await deps.store.hasWork(now());
  } catch {
    hasWork = true;
  }
  if (!hasWork) return;
  const enter = deps.enterScope ?? ((reason, run) => enterSystemScope(reason, run));
  await enter(COMMAND_OUTBOX_DRAIN_SCOPE_REASON, async () => {
    try {
      const result = await drainCommandOutbox({
        store: deps.store,
        handlers: deps.handlers,
        log: deps.log,
        ...(deps.now !== undefined ? { now: deps.now } : {}),
      });
      const did =
        result.delivered + result.retried + result.dead + result.released + result.reclaimed +
        result.purged.delivered + result.purged.dead;
      if (did > 0) {
        deps.log.info(
          { ...result },
          'command_outbox: drain finished' + (result.reachedBatchLimit ? '; more are due and the next tick continues' : ''),
        );
      }
    } catch (error) {
      deps.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'command_outbox: the drain failed; the next tick retries',
      );
    }
  });
}

export function createCommandOutboxDrainQueue(redis: Redis, prefix?: string): Queue<CommandOutboxDrainJobData> {
  return new Queue<CommandOutboxDrainJobData>(COMMAND_OUTBOX_DRAIN_QUEUE, {
    connection: redis,
    ...(prefix !== undefined ? { prefix } : {}),
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

export function buildCommandOutboxDrainWorker(
  deps: CommandOutboxDrainTickDeps & { readonly redis: Redis; readonly prefix?: string },
): Worker<CommandOutboxDrainJobData> {
  return new Worker<CommandOutboxDrainJobData>(COMMAND_OUTBOX_DRAIN_QUEUE, () => runCommandOutboxDrainTick(deps), {
    connection: deps.redis,
    concurrency: 1,
    ...(deps.prefix !== undefined ? { prefix: deps.prefix } : {}),
  });
}

/** Install the schedule. Idempotent by scheduler id: every boot of every worker process calls it. */
export async function ensureCommandOutboxDrainSchedule(
  queue: Pick<Queue<CommandOutboxDrainJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    COMMAND_OUTBOX_DRAIN_SCHEDULER_ID,
    { every: COMMAND_OUTBOX_DRAIN_EVERY_MS },
    { name: 'tick', data: {} },
  );
}

/**
 * Build and start the consumer where the host says this process runs one.
 * `attach` is `ctx.worker`; `onClose` registers the queue's own shutdown.
 * Answers whether a consumer was started.
 */
export async function startCommandOutboxDrain(
  input: CommandOutboxDrainTickDeps & {
    readonly processRunsWorkers: boolean;
    readonly moduleQueueRedis: Redis | undefined;
    readonly attach: (worker: Worker<CommandOutboxDrainJobData>) => void;
    readonly onClose: (close: () => Promise<void>) => void;
    readonly queuePrefix?: string;
  },
): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis, queuePrefix } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createCommandOutboxDrainQueue(moduleQueueRedis, queuePrefix);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    buildCommandOutboxDrainWorker({
      store: input.store,
      handlers: input.handlers,
      log: input.log,
      redis: moduleQueueRedis,
      ...(queuePrefix !== undefined ? { prefix: queuePrefix } : {}),
    }),
  );
  await ensureCommandOutboxDrainSchedule(queue);
  return true;
}
