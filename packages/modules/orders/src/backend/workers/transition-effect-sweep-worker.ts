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
 * the cost of a tick with nothing outstanding is two indexed statements.
 */

export const TRANSITION_EFFECT_SWEEP_QUEUE = 'orders.transition_effects.sweep';
export const TRANSITION_EFFECT_SWEEP_SCHEDULER_ID = 'orders.transition_effects.sweep';
/** Every sixty seconds. */
export const TRANSITION_EFFECT_SWEEP_EVERY_MS = 60_000;

export type TransitionEffectSweepJobData = Record<string, never>;

export interface TransitionEffectSweepDeps {
  readonly effects: Pick<OrderTransitionEffectService, 'sweep'>;
  readonly log: PlatformLogger;
}

/**
 * One tick: one `sweep()`, under a system tenant scope.
 *
 * The scope is established here, at the entry point, rather than left to
 * whoever builds the BullMQ worker around it: a worker has no request and
 * therefore no tenant context, and the sweep reads every organization's rows.
 *
 * A failed pass is logged and **not** re-thrown. Failing the job would buy
 * nothing — the next tick is the retry, sixty seconds later, and it re-reads
 * the same rows — while a job that fails on every transient database blip is
 * noise an operator learns to ignore. The exception is a module switched off
 * underneath a follow-up that had already found it present: that is never
 * swallowed (module-composition item 7), it fails this one job, and the next
 * tick finds the row waiting on its owner.
 */
export function transitionEffectSweepProcessor(deps: TransitionEffectSweepDeps): () => Promise<void> {
  const tick = sweepTick(deps);
  return () => enterSystemScope(SWEEP_SCOPE_REASON, tick);
}

const SWEEP_SCOPE_REASON = 'orders: sweep outstanding order follow-ups';

/** The body of one tick, without the scope its entry point establishes. */
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
  const tick = sweepTick(deps);
  // The scope is written at the site that has no caller — the function BullMQ
  // invokes — so it is visible where the entry point is, like every other
  // queue consumer in the tree. One tick at a time per process: a second
  // concurrent sweep in the same process would only skip the rows the first
  // holds.
  return new Worker<TransitionEffectSweepJobData>(
    TRANSITION_EFFECT_SWEEP_QUEUE,
    () => enterSystemScope(SWEEP_SCOPE_REASON, tick),
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
