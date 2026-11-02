import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';

/**
 * The `forms-maintenance` clock (`specs/170-forms-module/` research R-20, data-model §10,
 * Constitution X). The tasks reminders worker is the model.
 *
 * **BullMQ is the clock and nothing more.** One module-wide Job Scheduler fires every fifteen
 * minutes and its job carries no data: what is due is read from the tables on every tick, so a
 * flushed Redis loses a tick and never a deletion, and a changed retention period has no queue to
 * keep in step. Every pass is idempotent — deleting what is due, erasing what belongs to an
 * anonymised account and recomputing a counter each find nothing the second time — so two worker
 * processes ticking at once cost a little work and change nothing.
 *
 * **One tick, three passes**, in order: **retention** (entries past their form's period, FR-054),
 * **erasure reconciliation** (the entries of accounts anonymised while the subscriber could not
 * hear it, FR-047, research R-17 c) and **counter repair** (each form's `accepted_entry_count`
 * recomputed from its entries). Co-located in the existing worker process: the volume is one tick a
 * quarter-hour, and it stays a separable `ctx.worker` entrypoint.
 */

export const FORMS_MAINTENANCE_QUEUE = 'forms-maintenance';
export const FORMS_MAINTENANCE_SCHEDULER_ID = FORMS_MAINTENANCE_QUEUE;
/** Every fifteen minutes. */
export const FORMS_MAINTENANCE_EVERY_MS = 15 * 60_000;

export const FORMS_RETENTION_SCOPE_REASON = "forms: delete the entries past their form's retention period";
export const FORMS_ERASURE_SCOPE_REASON = 'forms: erase the entries of anonymised customer accounts';
export const FORMS_COUNTER_REPAIR_SCOPE_REASON = 'forms: recompute the accepted-entry counter of each form';

export type FormsMaintenanceJobData = Record<string, never>;

/** One pass of a tick: a yes-or-no probe outside any scope, and the work inside the system scope. */
export interface FormsMaintenancePass {
  readonly scopeReason: string;
  /** Whether {@link run} could do anything at `now` — yes or no, read from global rows only. */
  hasWork(now: Date): Promise<boolean>;
  run(now: Date): Promise<unknown>;
}

export interface FormsMaintenanceJobDeps {
  /** Whether this module is present — the platform's one answer, on both axes. */
  readonly isPresent: () => boolean;
  readonly retention: FormsMaintenancePass;
  readonly erasure: FormsMaintenancePass;
  readonly counters: FormsMaintenancePass;
  readonly log: { warn(context: Record<string, unknown>, message: string): void };
}

/**
 * One tick. For each pass: **presence first**, outside any `try` (Constitution XVII — a module that
 * is off asks its tables nothing; nothing is lost, since every pass is level-triggered and the
 * first tick after the return finds what accumulated, US9-3), then the probe, outside any scope — a
 * question that cannot be answered counts as yes — and only then the system scope, whose entry
 * writes the `tenant.escape_hatch` audit row: an idle installation writes none.
 *
 * A failed pass is logged and not re-thrown: the next tick is the retry. A module switched off
 * underneath a pass is the exception.
 */
export async function runFormsMaintenanceJob(deps: FormsMaintenanceJobDeps, now: Date = new Date()): Promise<void> {
  const run = async (pass: FormsMaintenancePass): Promise<void> => {
    let hasWork = true;
    try {
      hasWork = await pass.hasWork(now);
    } catch (error) {
      rethrowIfModuleDisabled(error);
      hasWork = true;
    }
    if (!hasWork) return;
    try {
      // There is no request behind a tick, and every pass is platform-wide by design.
      await enterSystemScope(pass.scopeReason, () => pass.run(now));
    } catch (error) {
      rethrowIfModuleDisabled(error);
      deps.log.warn(
        { pass: pass.scopeReason, error: error instanceof Error ? error.message : String(error) },
        'forms: a maintenance pass failed; the next tick retries',
      );
    }
  };

  for (const pass of [deps.retention, deps.erasure, deps.counters]) {
    if (!deps.isPresent()) return;
    await run(pass);
  }
}

export function createFormsMaintenanceQueue(redis: Redis): Queue<FormsMaintenanceJobData> {
  return new Queue<FormsMaintenanceJobData>(FORMS_MAINTENANCE_QUEUE, {
    connection: redis,
    // A tick is worth nothing once it has run: a short tail, and no history beyond it.
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

/** Install the module-wide schedule. Idempotent by scheduler id, so safe on every boot of every worker process. */
export async function ensureFormsMaintenanceSchedule(
  queue: Pick<Queue<FormsMaintenanceJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    FORMS_MAINTENANCE_SCHEDULER_ID,
    { every: FORMS_MAINTENANCE_EVERY_MS },
    { name: 'tick', data: {} },
  );
}

/**
 * Build and start the consumer — where the host says this process runs one
 * (`processRunsWorkers`) **and** offers a connection (`moduleQueueRedis`). The shared test server
 * says neither, builds nothing, and its tests drive {@link runFormsMaintenanceJob} directly.
 *
 * `attach` is the platform's worker seam — `ctx.worker` — which stops the consumer with the module
 * and leaves a tick taken while it is off waiting; `onClose` registers the queue's own shutdown.
 * Answers whether a consumer was started.
 */
export async function startFormsMaintenance(input: {
  readonly deps: FormsMaintenanceJobDeps;
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly attach: (worker: Worker<FormsMaintenanceJobData>) => void;
  readonly onClose: (close: () => Promise<void>) => void;
}): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createFormsMaintenanceQueue(moduleQueueRedis);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    // One tick at a time per process: a second concurrent pass would only find the first's work done.
    new Worker<FormsMaintenanceJobData>(FORMS_MAINTENANCE_QUEUE, () => runFormsMaintenanceJob(input.deps), {
      connection: moduleQueueRedis,
      concurrency: 1,
    }),
  );
  await ensureFormsMaintenanceSchedule(queue);
  return true;
}
