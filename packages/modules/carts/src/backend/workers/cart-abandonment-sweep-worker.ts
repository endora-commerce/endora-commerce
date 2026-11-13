import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  enterSystemScope,
  rethrowIfModuleDisabled,
  type PlatformLogger,
} from '@endora-commerce/platform/kernel';
import type { CartAbandonmentWorker } from '../services/cart-abandonment-worker.js';

/**
 * The clock for the cart abandonment sweep (issue #1119).
 *
 * `CartAbandonmentWorker.sweep()` marks idle active carts `abandoned` and,
 * since #602, removes working baskets orphaned by a placement that never
 * finished. Until this file it ran only when an operator scheduled the
 * `carts abandonment-sweep` command themselves, so on an instance without that
 * cron entry neither ever happened. The command stays, for a manual pass.
 *
 * **BullMQ is the clock and nothing more.** One module-wide Job Scheduler fires
 * every fifteen minutes and its job carries no data: what is due is read from
 * the table on every tick, so a flushed Redis loses a tick and never a cart. A
 * scheduler rather than a `setInterval` for the reason every periodic job here
 * is — Principle X keeps timers out of the API process, and a Redis-held
 * schedule survives a deploy.
 *
 * **Idempotent, and more than one consumer is harmless.** A pass flips only
 * carts with no `abandonment_notified_at` and deletes only working baskets past
 * their age, so a repeated or concurrent pass finds nothing the first one did
 * not already settle.
 *
 * **An idle tick enters no scope.** The tick first asks
 * `CartAbandonmentWorker.hasSweepWork()` — one boolean, read with no tenant
 * context — and opens the system scope only when the answer is yes, so an
 * instance with nothing to sweep writes no `tenant.escape_hatch` audit row
 * every quarter of an hour.
 *
 * The interval is a constant, not a setting: the abandonment threshold is
 * counted in minutes (seven days by default) and the orphan age is an hour, so
 * fifteen minutes of lateness is small against either.
 */

export const CART_ABANDONMENT_SWEEP_QUEUE = 'carts.abandonment.sweep';
export const CART_ABANDONMENT_SWEEP_SCHEDULER_ID = 'carts.abandonment.sweep';
/** Every fifteen minutes. */
export const CART_ABANDONMENT_SWEEP_EVERY_MS = 15 * 60 * 1000;

export type CartAbandonmentSweepJobData = Record<string, never>;

export interface CartAbandonmentSweepDeps {
  readonly sweep: Pick<CartAbandonmentWorker, 'hasSweepWork' | 'sweepInScope'>;
  readonly log: PlatformLogger;
}

export const CART_ABANDONMENT_SWEEP_SCOPE_REASON = 'carts: abandonment sweep';

/**
 * The body of one pass, inside the scope.
 *
 * A failed pass is logged and **not** re-thrown. Failing the job would buy
 * nothing — the next tick is the retry, and it re-reads the same rows. The
 * exception is a module switched off underneath the pass: that is never
 * swallowed (module-composition item 7) and fails this one job.
 */
function sweepTick(deps: CartAbandonmentSweepDeps): () => Promise<void> {
  return async () => {
    try {
      const result = await deps.sweep.sweepInScope();
      if (result.abandonedCount > 0 || result.workingBasketsRemoved > 0) {
        deps.log.info({ ...result }, 'carts: abandonment sweep finished');
      }
    } catch (error) {
      rethrowIfModuleDisabled(error);
      deps.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'carts: the abandonment sweep failed; the next tick retries',
      );
    }
  };
}

/**
 * What BullMQ invokes for one job: ask whether anything is due, and open the
 * system scope only when something is.
 *
 * **The question is asked outside any scope and answers yes or no, nothing
 * else** (`CartAbandonmentWorker.hasSweepWork`). Everything a pass reads or
 * writes is read inside the scope, by the pass itself.
 *
 * **A question that cannot be answered counts as yes.** The tick then runs
 * with its scope and its audit record: a failing probe may cost an audit row,
 * and can never save one. A module switched off is the one thing that is not a
 * failed question, and is never absorbed.
 */
export async function runCartAbandonmentSweepTick(deps: CartAbandonmentSweepDeps): Promise<void> {
  let hasWork = true;
  try {
    hasWork = await deps.sweep.hasSweepWork();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    hasWork = true;
  }
  if (!hasWork) return;
  await enterSystemScope(CART_ABANDONMENT_SWEEP_SCOPE_REASON, sweepTick(deps));
}

export function createCartAbandonmentSweepQueue(
  redis: Redis,
  prefix?: string,
): Queue<CartAbandonmentSweepJobData> {
  return new Queue<CartAbandonmentSweepJobData>(CART_ABANDONMENT_SWEEP_QUEUE, {
    connection: redis,
    ...(prefix !== undefined ? { prefix } : {}),
    // A tick is worth nothing once it has run: keep a short tail for an
    // operator looking at the queue, and no history beyond it.
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

export function buildCartAbandonmentSweepWorker(
  deps: CartAbandonmentSweepDeps & { readonly redis: Redis; readonly prefix?: string },
): Worker<CartAbandonmentSweepJobData> {
  // One tick at a time per process: a second concurrent pass in the same
  // process would only race the first for the same rows.
  return new Worker<CartAbandonmentSweepJobData>(
    CART_ABANDONMENT_SWEEP_QUEUE,
    // The scope is opened one call down, in `runCartAbandonmentSweepTick`, and
    // only for a tick that has something to do.
    () => runCartAbandonmentSweepTick(deps),
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
export async function ensureCartAbandonmentSweepSchedule(
  queue: Pick<Queue<CartAbandonmentSweepJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    CART_ABANDONMENT_SWEEP_SCHEDULER_ID,
    { every: CART_ABANDONMENT_SWEEP_EVERY_MS },
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
 * `carts` is off no tick runs; the tick that waited runs once it is back.
 * `onClose` registers the queue's own shutdown. `queuePrefix` is BullMQ's key
 * prefix and is left alone in production: a test that shares a Redis with other
 * runs sets one of its own. Answers whether a consumer was started.
 */
export async function startCartAbandonmentSweep(
  input: CartAbandonmentSweepDeps & {
    readonly processRunsWorkers: boolean;
    readonly moduleQueueRedis: Redis | undefined;
    readonly attach: (worker: Worker<CartAbandonmentSweepJobData>) => void;
    readonly onClose: (close: () => Promise<void>) => void;
    readonly queuePrefix?: string;
  },
): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis, queuePrefix } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createCartAbandonmentSweepQueue(moduleQueueRedis, queuePrefix);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    buildCartAbandonmentSweepWorker({
      redis: moduleQueueRedis,
      sweep: input.sweep,
      log: input.log,
      ...(queuePrefix !== undefined ? { prefix: queuePrefix } : {}),
    }),
  );
  await ensureCartAbandonmentSweepSchedule(queue);
  return true;
}
