import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  enterSystemScope,
  rethrowIfModuleDisabled,
  type PlatformLogger,
} from '@endora-commerce/platform/kernel';
import type { EventReminderService } from '../services/event-reminder-service.js';

/**
 * The clock for the reminders of Events
 * (`specs/143-crm-sales-opportunities/research.md` N-CAL5; Constitution X).
 *
 * **BullMQ is the clock and nothing more.** One module-wide Job Scheduler fires
 * every sixty seconds and its job carries no data: what is due is read from
 * `crm_opportunity_events` on every tick, so a flushed Redis loses a tick and
 * never a reminder, and an edit, a delete, a closing or a reassignment has no
 * queue to keep in step. A reminder is therefore up to a minute late.
 *
 * **More than one consumer is fine.** A reminder is claimed with `for update
 * skip locked` before it is delivered, so two worker processes ticking at once
 * split the rows rather than sending any twice.
 *
 * A queue of its own rather than a second job kind on `crm-value-recalculation`:
 * a periodic tick and a bulk recalculation share neither a payload nor retry
 * settings, and one queue would couple the two.
 *
 * The interval is a constant, not a setting: nobody has asked to tune it, and a
 * tick with nothing due is one statement — the question
 * `runEventReminderJob` asks before it opens a scope. That statement is not
 * an index lookup: nothing indexes a claim left `sending`, so it reads the
 * Events table, as the pass's own `interrupted` update always has.
 */

export const EVENT_REMINDER_QUEUE = 'crm-event-reminders';
export const EVENT_REMINDER_SCHEDULER_ID = 'crm-event-reminders';
/** Every sixty seconds. */
export const EVENT_REMINDER_EVERY_MS = 60_000;

export type EventReminderJobData = Record<string, never>;

export const EVENT_REMINDER_SCOPE_REASON = 'crm: deliver due event reminders';

export interface EventReminderTickDeps {
  readonly reminders: Pick<EventReminderService, 'sweep'>;
  /** Whether this module is present — the platform's one answer, on both axes. */
  readonly isPresent: () => boolean;
  readonly log: PlatformLogger;
}

/**
 * The body of one tick: one pass of the sweep.
 *
 * **Presence is decided first, outside the `try`** (Constitution XVII;
 * `specs/conventions/module-activation.md`). The consumer stops with the module
 * because it is attached through the platform's worker seam; this is the same
 * question asked once more by the work itself, for the tick already in hand
 * when the module was switched off — a module that is off reminds nobody, and
 * the reminder waits in its row for up to 24 hours.
 *
 * A failed pass is logged and **not** re-thrown: the next tick is the retry,
 * sixty seconds later, and it reads the same rows — whatever this pass had
 * claimed and not delivered it gave back before it stopped. A module switched
 * off underneath a delivery is the exception and is never swallowed.
 */
export function eventReminderTick(deps: EventReminderTickDeps): () => Promise<void> {
  return async () => {
    if (!deps.isPresent()) return;
    try {
      await deps.reminders.sweep();
    } catch (error) {
      rethrowIfModuleDisabled(error);
      deps.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'crm: a pass over the due event reminders failed; the next tick retries',
      );
    }
  };
}

export interface EventReminderJobDeps {
  /** One pass, run inside the system scope — {@link eventReminderTick}. */
  readonly tick: () => Promise<void>;
  /** Whether this module is present — asked before anything is read. */
  readonly isPresent: () => boolean;
  /** Whether a pass would do anything: yes or no, and nothing else. */
  readonly hasWork: () => Promise<boolean>;
}

/**
 * What BullMQ invokes for one job: ask whether a pass has anything to do, and
 * open the system scope only when it has (issue #120).
 *
 * Entering the scope is what writes the `tenant.escape_hatch` audit record, and
 * a tick is sixty seconds from the last — further apart than the audit
 * writer's aggregation window — so a scope entered on every tick is one audit
 * row a minute on an instance where nobody was reminded of anything.
 *
 * **Presence first.** A module that is off asks its tables nothing.
 *
 * **The question is asked outside any scope and answers yes or no, nothing
 * else** (`EventReminderService.hasSweepWork`): no row, no id, no count leaves
 * it. Everything a pass reads or writes is still read inside the scope, by the
 * pass itself — the answer decides only *whether* the scope is entered.
 *
 * **A question that cannot be answered counts as yes.** The tick then runs as
 * it always did, scope and audit record included: a failing probe may cost an
 * audit row, and can never save one. A module switched off is the one thing
 * that is not a failed question, and is never absorbed.
 */
export async function runEventReminderJob(deps: EventReminderJobDeps): Promise<void> {
  if (!deps.isPresent()) return;
  let hasWork = true;
  try {
    hasWork = await deps.hasWork();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    hasWork = true;
  }
  if (!hasWork) return;
  // There is no request behind a tick, and the pass is platform-wide by design.
  await enterSystemScope(EVENT_REMINDER_SCOPE_REASON, deps.tick);
}

export function createEventReminderQueue(redis: Redis): Queue<EventReminderJobData> {
  return new Queue<EventReminderJobData>(EVENT_REMINDER_QUEUE, {
    connection: redis,
    // A tick is worth nothing once it has run: a short tail for whoever looks
    // at the queue, and no history beyond it.
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

/**
 * Install the module-wide schedule. Idempotent by scheduler id, so it is safe
 * on every boot of every worker process — which is how it is called.
 */
export async function ensureEventReminderSchedule(
  queue: Pick<Queue<EventReminderJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    EVENT_REMINDER_SCHEDULER_ID,
    { every: EVENT_REMINDER_EVERY_MS },
    { name: 'sweep', data: {} },
  );
}

/**
 * Build and start the consumer — where the host says this process runs one
 * (`processRunsWorkers`) **and** offers a connection to build it on
 * (`moduleQueueRedis`). The shared test server says neither, builds nothing,
 * and its tests drive the sweep and the tick directly.
 *
 * `attach` is the platform's worker seam — `ctx.worker` — which is what puts
 * the consumer in the registry the platform reconciles and stops with the
 * module; `onClose` registers the queue's own shutdown. Answers whether a
 * consumer was started.
 */
export async function startEventReminders(
  input: EventReminderJobDeps & {
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly attach: (worker: Worker<EventReminderJobData>) => void;
  readonly onClose: (close: () => Promise<void>) => void;
  },
): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createEventReminderQueue(moduleQueueRedis);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    // One tick at a time per process: a second concurrent pass would only
    // skip the rows the first holds.
    new Worker<EventReminderJobData>(EVENT_REMINDER_QUEUE, () => runEventReminderJob(input), {
      connection: moduleQueueRedis,
      concurrency: 1,
    }),
  );
  await ensureEventReminderSchedule(queue);
  return true;
}
