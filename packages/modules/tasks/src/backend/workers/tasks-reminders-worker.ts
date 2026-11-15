import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';

/**
 * The clock for Task reminders and the daily digest (`specs/165-task-management/`
 * research R-17, R-18, `contracts/ports-and-events.md` §8; Constitution X).
 * Projects' `stage-alert-worker.ts` and CRM's `event-reminder-worker.ts` are
 * the model.
 *
 * **BullMQ is the clock and nothing more.** One module-wide Job Scheduler fires
 * every sixty seconds and its job carries no data: what is due is read from
 * the tables on every tick, so a flushed Redis loses a tick and never a
 * reminder, and a moved due date has no queue to keep in step. A reminder goes
 * out within a minute or two of its moment (SC-004).
 *
 * **One tick, up to four passes.** The time-zone pass (`#505` — due dates and
 * relative reminders re-derived once `tasks.time_zone` has changed) and then
 * the reminders on every tick; the digest and the maintenance pass (`#450`,
 * User Story 10 — Tasks whose context's record is gone) each when fifteen
 * minutes have passed since its last run in this process — an in-memory stamp
 * per pass, so a restart only makes it run sooner, and a clock that went back
 * runs it at once.
 *
 * **More than one consumer is fine.** A reminder is claimed per recipient by
 * its delivery row, a digest per person and day by its subscription row, so
 * two worker processes ticking at once tell each person once.
 */

export const TASKS_REMINDERS_QUEUE = 'tasks-reminders';
export const TASKS_REMINDERS_SCHEDULER_ID = TASKS_REMINDERS_QUEUE;
/** Every sixty seconds. */
export const TASKS_REMINDERS_EVERY_MS = 60_000;
/** The digest pass runs at most this often. */
export const TASKS_DIGEST_EVERY_MS = 15 * 60_000;
/** The maintenance pass runs at most this often — within the hour SC-006 allows, with margin (R-19). */
export const TASKS_MAINTENANCE_EVERY_MS = 15 * 60_000;

export const TASKS_REMINDERS_SCOPE_REASON = 'tasks: deliver due reminders';
export const TASKS_DIGEST_SCOPE_REASON = 'tasks: send the daily digests';
export const TASKS_MAINTENANCE_SCOPE_REASON = 'tasks: clean up Tasks whose context is gone';
export const TASKS_REDERIVE_SCOPE_REASON = 'tasks: re-derive due dates and reminders in the Tasks time zone';

export type TasksRemindersJobData = Record<string, never>;

/** One pass of a tick: a yes-or-no probe outside any scope, and the work inside the system scope. */
export interface TaskSweepPass {
  readonly scopeReason: string;
  /** Whether {@link run} would do anything at `now` — yes or no, and nothing else (issue #120). */
  hasWork(now: Date): Promise<boolean>;
  run(now: Date): Promise<unknown>;
}

export interface TasksRemindersJobDeps {
  /** Whether this module is present — the platform's one answer, on both axes. */
  readonly isPresent: () => boolean;
  readonly reminders: TaskSweepPass;
  readonly digest: TaskSweepPass;
  readonly maintenance: TaskSweepPass;
  /** Issue #505 — what was counted in an earlier `tasks.time_zone`, re-derived in the current one. */
  readonly rederive: TaskSweepPass;
  readonly log: { warn(context: Record<string, unknown>, message: string): void };
}

/** What one tick runs, and the cadence of its slower passes — one per process, shared by every tick of it. */
export interface TasksRemindersJob {
  readonly deps: TasksRemindersJobDeps;
  /** When each slower pass last ran in this process — in-memory stamps; `null` before the first. */
  readonly cadence: { digestRanAt: number | null; maintenanceRanAt: number | null };
}

export function createTasksRemindersJob(deps: TasksRemindersJobDeps): TasksRemindersJob {
  return { deps, cadence: { digestRanAt: null, maintenanceRanAt: null } };
}

/**
 * One tick. For each pass: **presence first** (Constitution XVII — a module
 * that is off asks its tables nothing and tells nobody, and nothing
 * accumulates: a reminder is then delivered on return only within its grace,
 * a digest only for the day it is), then the probe, outside any scope — a
 * question that cannot be answered counts as yes, since a failing probe may
 * cost an audit row and never a reminder — and only then the system scope,
 * whose entry writes the `tenant.escape_hatch` audit row (issue #120): 1 440
 * idle ticks a day write none.
 *
 * The time-zone pass and then the reminders run every tick — in that order, so
 * a reminder the zone moved is not sent at its old moment; the digest when {@link TASKS_DIGEST_EVERY_MS}
 * and the maintenance pass when {@link TASKS_MAINTENANCE_EVERY_MS} have passed
 * since each last ran (a clock that went back runs it at once). A
 * failed pass is logged and not re-thrown: the next tick is the retry. A
 * module switched off underneath a pass is the exception.
 */
export async function runTasksRemindersJob(job: TasksRemindersJob, now: Date = new Date()): Promise<void> {
  const { deps, cadence } = job;
  const run = async (pass: TaskSweepPass): Promise<void> => {
    let hasWork = true;
    try {
      hasWork = await pass.hasWork(now);
    } catch (error) {
      rethrowIfModuleDisabled(error);
      hasWork = true;
    }
    if (!hasWork) return;
    try {
      // There is no request behind a tick, and the pass is platform-wide by design.
      await enterSystemScope(pass.scopeReason, () => pass.run(now));
    } catch (error) {
      rethrowIfModuleDisabled(error);
      deps.log.warn(
        { pass: pass.scopeReason, error: error instanceof Error ? error.message : String(error) },
        'tasks: a scheduled pass failed; the next tick retries',
      );
    }
  };

  const at = now.getTime();
  const due = (last: number | null, every: number): boolean => last === null || at < last || at - last >= every;

  if (!deps.isPresent()) return;
  await run(deps.rederive);
  if (!deps.isPresent()) return;
  await run(deps.reminders);
  if (due(cadence.digestRanAt, TASKS_DIGEST_EVERY_MS)) {
    if (!deps.isPresent()) return;
    cadence.digestRanAt = at;
    await run(deps.digest);
  }
  if (due(cadence.maintenanceRanAt, TASKS_MAINTENANCE_EVERY_MS)) {
    if (!deps.isPresent()) return;
    cadence.maintenanceRanAt = at;
    await run(deps.maintenance);
  }
}

export function createTasksRemindersQueue(redis: Redis): Queue<TasksRemindersJobData> {
  return new Queue<TasksRemindersJobData>(TASKS_REMINDERS_QUEUE, {
    connection: redis,
    // A tick is worth nothing once it has run: a short tail, and no history beyond it.
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

/** Install the module-wide schedule. Idempotent by scheduler id, so safe on every boot of every worker process. */
export async function ensureTasksRemindersSchedule(
  queue: Pick<Queue<TasksRemindersJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    TASKS_REMINDERS_SCHEDULER_ID,
    { every: TASKS_REMINDERS_EVERY_MS },
    { name: 'sweep', data: {} },
  );
}

/**
 * Build and start the consumer — where the host says this process runs one
 * (`processRunsWorkers`) **and** offers a connection to build it on
 * (`moduleQueueRedis`). The shared test server says neither, builds nothing,
 * and its tests drive the job directly.
 *
 * `attach` is the platform's worker seam — `ctx.worker` — which puts the
 * consumer in the registry the platform reconciles and stops it with the
 * module; `onClose` registers the queue's own shutdown. Answers whether a
 * consumer was started.
 */
export async function startTasksReminders(input: {
  readonly job: TasksRemindersJob;
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly attach: (worker: Worker<TasksRemindersJobData>) => void;
  readonly onClose: (close: () => Promise<void>) => void;
}): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createTasksRemindersQueue(moduleQueueRedis);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    // One tick at a time per process: a second concurrent pass would only find the first's claims.
    new Worker<TasksRemindersJobData>(TASKS_REMINDERS_QUEUE, () => runTasksRemindersJob(input.job), {
      connection: moduleQueueRedis,
      concurrency: 1,
    }),
  );
  await ensureTasksRemindersSchedule(queue);
  return true;
}
