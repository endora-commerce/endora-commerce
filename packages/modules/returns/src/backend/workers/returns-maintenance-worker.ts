import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';

/**
 * The `returns-maintenance` clock (`specs/180-off-platform-complaints/` research R-15,
 * Constitution X; `forms`' `forms-maintenance-worker.ts` is the model): once a day it
 * deletes the pending uploads nobody filed, and erases the cases of accounts anonymised
 * while `returns` was off. Presence first, each pass inside the system scope with its own
 * reason, a failed pass logged and retried on the next tick.
 */

export const RETURNS_MAINTENANCE_QUEUE = 'returns-maintenance';
export const RETURNS_MAINTENANCE_SCHEDULER_ID = RETURNS_MAINTENANCE_QUEUE;
export const RETURNS_MAINTENANCE_EVERY_MS = 24 * 60 * 60_000;

export const RETURNS_UPLOAD_SWEEP_SCOPE_REASON = 'returns: delete the pending uploads nobody filed';
export const RETURNS_ERASURE_SCOPE_REASON = 'returns: erase the cases of anonymised customer accounts';

export type ReturnsMaintenanceJobData = Record<string, never>;

export interface ReturnsMaintenancePass {
  readonly scopeReason: string;
  hasWork(now: Date): Promise<boolean>;
  run(now: Date): Promise<unknown>;
}

export interface ReturnsMaintenanceJobDeps {
  readonly isPresent: () => boolean;
  readonly uploads: ReturnsMaintenancePass;
  readonly erasure: ReturnsMaintenancePass;
  readonly log: { warn(context: Record<string, unknown>, message: string): void };
}

export async function runReturnsMaintenanceJob(deps: ReturnsMaintenanceJobDeps, now: Date = new Date()): Promise<void> {
  const run = async (pass: ReturnsMaintenancePass): Promise<void> => {
    let hasWork = true;
    try {
      hasWork = await pass.hasWork(now);
    } catch (error) {
      rethrowIfModuleDisabled(error);
      hasWork = true;
    }
    if (!hasWork) return;
    try {
      await enterSystemScope(pass.scopeReason, () => pass.run(now));
    } catch (error) {
      rethrowIfModuleDisabled(error);
      deps.log.warn(
        { pass: pass.scopeReason, error: error instanceof Error ? error.message : String(error) },
        'returns: a maintenance pass failed; the next tick retries',
      );
    }
  };
  for (const pass of [deps.uploads, deps.erasure]) {
    if (!deps.isPresent()) return;
    await run(pass);
  }
}

export async function startReturnsMaintenance(input: {
  readonly deps: ReturnsMaintenanceJobDeps;
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly attach: (worker: Worker<ReturnsMaintenanceJobData>) => void;
  readonly onClose: (close: () => Promise<void>) => void;
}): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = new Queue<ReturnsMaintenanceJobData>(RETURNS_MAINTENANCE_QUEUE, {
    connection: moduleQueueRedis,
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 }, attempts: 3 },
  });
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    new Worker<ReturnsMaintenanceJobData>(RETURNS_MAINTENANCE_QUEUE, () => runReturnsMaintenanceJob(input.deps), {
      connection: moduleQueueRedis,
      concurrency: 1,
    }),
  );
  await queue.upsertJobScheduler(
    RETURNS_MAINTENANCE_SCHEDULER_ID,
    { every: RETURNS_MAINTENANCE_EVERY_MS },
    { name: 'sweep', data: {} },
  );
  return true;
}
