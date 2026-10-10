import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  enterSystemScope,
  rethrowIfModuleDisabled,
  type PlatformLogger,
} from '@endora-commerce/platform/kernel';
import type { OrderTransitionEffectService } from '../services/order-transition-effect-service.js';

/**
 * The clock for outstanding order follow-ups
 * (`specs/142-order-transition-atomicity/`, D6, FR-007, FR-012).
 *
 * A follow-up an order transition owes — a stock release, a credit release —
 * is a row in `order_transition_effects`, and it is attempted in the request
 * that committed the transition. This worker is what runs the ones that
 * attempt did not complete: a release that failed, a process that died after
 * the commit, a module that was switched off and is back.
 *
 * **BullMQ is the clock and nothing more.** One module-wide Job Scheduler fires
 * every sixty seconds and its job carries no data: what is owed is read from
 * the table on every tick, so a flushed Redis loses a tick and never a release.
 * It is a scheduler rather than a `setInterval` for the reason every periodic
 * job here is — Principle X keeps timers out of the API process, and a
 * Redis-held schedule survives a deploy.
 *
 * **More than one consumer is fine.** Each row is claimed with `for update skip
 * locked` by whoever attempts it, so two worker processes sweeping at once
 * split the rows between them rather than running any twice.
 *
 * The interval is a constant, not a setting: nobody has asked to tune it, and
 * the cost of a tick with nothing outstanding is one statement — the
 * question `runTransitionEffectSweepTick` asks before it opens a scope.
 */

export const TRANSITION_EFFECT_SWEEP_QUEUE = 'orders.transition_effects.sweep';
export const TRANSITION_EFFECT_SWEEP_SCHEDULER_ID = 'orders.transition_effects.sweep';
/** Every sixty seconds. */
export const TRANSITION_EFFECT_SWEEP_EVERY_MS = 60_000;

export type TransitionEffectSweepJobData = Record<string, never>;

export interface TransitionEffectSweepDeps {
  readonly effects: Pick<OrderTransitionEffectService, 'sweep' | 'hasSweepWork'>;
  readonly log: PlatformLogger;
}

export const SWEEP_SCOPE_REASON = 'orders: sweep outstanding order follow-ups';

/**
 * The body of one tick: one `sweep()`.
 *
 * A failed pass is logged and **not** re-thrown. Failing the job would buy
 * nothing — the next tick is the retry, sixty seconds later, and it re-reads
 * the same rows — while a job that fails on every transient database blip is
 * noise an operator learns to ignore. The exception is a module switched off
 * underneath a follow-up that had already found it present: that is never
 * swallowed (module-composition item 7), it fails this one job, and the next
 * tick finds the row waiting on its owner.
 */
function sweepTick(deps: TransitionEffectSweepDeps): () => Promise<void> {
  return async () => {
    try {
      await deps.effects.sweep();
    } catch (error) {
      rethrowIfModuleDisabled(error);
      deps.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'orders: a sweep of outstanding order follow-ups failed; the next tick retries',
      );
    }
  };
}

/**
 * What BullMQ invokes for one job: ask whether a pass has anything to do, and
 * open the system scope only when it has (issue #120).
 *
 * Entering the scope is what writes the `tenant.escape_hatch` audit record, and
 * a tick is sixty seconds from the last — further apart than the audit
 * writer's aggregation window — so a scope entered on every tick is one audit
 * row a minute on an instance where nothing happened: a record of access that
 * read nobody's data.
 *
 * **The question is asked outside any scope and answers yes or no, nothing
 * else** (`OrderTransitionEffectService.hasSweepWork`): no row, no id, no
 * count leaves it, so there is nothing for an audit row to record. Everything
 * a pass reads or writes is still read inside the scope, by `sweep()` itself —
 * the answer here decides only *whether* the scope is entered, and is never
 * handed to the pass.
 *
 * **A question that cannot be answered counts as yes.** The tick then runs as
 * it always did, scope and audit record included: a failing probe may cost an
 * audit row, and can never save one. A module switched off is the one thing
 * that is not a failed question, and is never absorbed.
 */
export async function runTransitionEffectSweepTick(deps: TransitionEffectSweepDeps): Promise<void> {
  let hasWork = true;
  try {
    hasWork = await deps.effects.hasSweepWork();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    hasWork = true;
  }
  if (!hasWork) return;
  await enterSystemScope(SWEEP_SCOPE_REASON, sweepTick(deps));
}

export function createTransitionEffectSweepQueue(redis: Redis): Queue<TransitionEffectSweepJobData> {
  return new Queue<TransitionEffectSweepJobData>(TRANSITION_EFFECT_SWEEP_QUEUE, {
    connection: redis,
    // A tick is worth nothing once it has run: keep a short tail for an
    // operator looking at the queue, and no history beyond it.
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

export function buildTransitionEffectSweepWorker(
  deps: TransitionEffectSweepDeps & { readonly redis: Redis },
): Worker<TransitionEffectSweepJobData> {
  // One tick at a time per process: a second concurrent sweep in the same
  // process would only skip the rows the first holds.
  return new Worker<TransitionEffectSweepJobData>(
    TRANSITION_EFFECT_SWEEP_QUEUE,
    // The scope is opened one call down, in `runTransitionEffectSweepTick` —
    // the function this site has no caller for — and only for a tick that has
    // something to do.
    () => runTransitionEffectSweepTick(deps),
    { connection: deps.redis, concurrency: 1 },
  );
}

/**
 * Install the module-wide schedule. Idempotent by scheduler id, so it is safe
 * to call on every boot of every worker process — which is how it is called.
 */
export async function ensureTransitionEffectSweepSchedule(
  queue: Pick<Queue<TransitionEffectSweepJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    TRANSITION_EFFECT_SWEEP_SCHEDULER_ID,
    { every: TRANSITION_EFFECT_SWEEP_EVERY_MS },
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
 * the consumer in the registry the platform reconciles and stops; `onClose`
 * registers the queue's own shutdown. Answers whether a consumer was started.
 */
export async function startTransitionEffectSweep(
  input: TransitionEffectSweepDeps & {
    readonly processRunsWorkers: boolean;
    readonly moduleQueueRedis: Redis | undefined;
    readonly attach: (worker: Worker<TransitionEffectSweepJobData>) => void;
    readonly onClose: (close: () => Promise<void>) => void;
  },
): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createTransitionEffectSweepQueue(moduleQueueRedis);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    buildTransitionEffectSweepWorker({
      redis: moduleQueueRedis,
      effects: input.effects,
      log: input.log,
    }),
  );
  await ensureTransitionEffectSweepSchedule(queue);
  return true;
}
