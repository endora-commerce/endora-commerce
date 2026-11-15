import { describe, expect, it, vi } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import {
  createTasksRemindersJob,
  runTasksRemindersJob,
  startTasksReminders,
  TASKS_DIGEST_EVERY_MS,
  TASKS_DIGEST_SCOPE_REASON,
  TASKS_MAINTENANCE_EVERY_MS,
  TASKS_MAINTENANCE_SCOPE_REASON,
  TASKS_REDERIVE_SCOPE_REASON,
  TASKS_REMINDERS_EVERY_MS,
  TASKS_REMINDERS_QUEUE,
  TASKS_REMINDERS_SCHEDULER_ID,
  TASKS_REMINDERS_SCOPE_REASON,
  type TaskSweepPass,
} from './tasks-reminders-worker.js';

/** BullMQ, stood in for: what is held here is what this module hands it, and no connection is opened. */
const bull = vi.hoisted(() => ({
  queues: [] as Array<{ name: string; upsertJobScheduler: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>,
  workers: [] as Array<{ name: string; processor: () => Promise<unknown>; options: Record<string, unknown> }>,
}));
vi.mock('bullmq', () => ({
  Queue: class {
    readonly upsertJobScheduler = vi.fn(async () => undefined);
    readonly close = vi.fn(async () => undefined);
    constructor(readonly name: string) {
      bull.queues.push(this);
    }
  },
  Worker: class {
    constructor(
      readonly name: string,
      readonly processor: () => Promise<unknown>,
      readonly options: Record<string, unknown>,
    ) {
      bull.workers.push(this);
    }
  },
}));

const log = () => ({ warn: vi.fn() });

function pass(scopeReason: string, hasWork: () => Promise<boolean> = async () => true) {
  const scopes: Array<string | undefined> = [];
  const run = vi.fn(async (_now: Date) => {
    scopes.push(getTenantContext()?.actor.kind);
  });
  const probe = vi.fn(hasWork);
  const value: TaskSweepPass = { scopeReason, hasWork: probe, run };
  return { value, run, probe, scopes };
}

/** A maintenance pass with nothing to do — for the cases about the other passes. */
const idle = (): TaskSweepPass => pass(TASKS_MAINTENANCE_SCOPE_REASON, async () => false).value;
/** A time-zone pass with nothing to do — for the cases about the other passes. */
const settled = (): TaskSweepPass => pass(TASKS_REDERIVE_SCOPE_REASON, async () => false).value;

describe('the tasks-reminders worker (R-17, R-18, R-19)', () => {
  it('names a queue BullMQ accepts, ticks every minute and runs the digest at most every fifteen', () => {
    expect(TASKS_REMINDERS_QUEUE).toBe('tasks-reminders');
    expect(TASKS_REMINDERS_SCHEDULER_ID).toBe(TASKS_REMINDERS_QUEUE);
    expect(TASKS_REMINDERS_EVERY_MS).toBe(60_000);
    expect(TASKS_DIGEST_EVERY_MS).toBe(15 * 60_000);
    expect(TASKS_MAINTENANCE_EVERY_MS).toBe(15 * 60_000);
  });

  it('runs the maintenance pass at most every fifteen minutes, in the system scope, and not at all while Tasks is off (#450)', async () => {
    const maintenance = pass(TASKS_MAINTENANCE_SCOPE_REASON);
    let present = true;
    const job = createTasksRemindersJob({
      isPresent: () => present,
      reminders: pass(TASKS_REMINDERS_SCOPE_REASON, async () => false).value,
      digest: pass(TASKS_DIGEST_SCOPE_REASON, async () => false).value,
      maintenance: maintenance.value,
      rederive: settled(),
      log: log(),
    });
    const start = Date.parse('2032-01-01T08:00:00Z');
    for (let minute = 0; minute <= 30; minute += 1) await runTasksRemindersJob(job, new Date(start + minute * 60_000));
    expect(maintenance.run.mock.calls.map(([now]) => (now.getTime() - start) / 60_000)).toEqual([0, 15, 30]);
    expect(maintenance.scopes).toEqual(['system', 'system', 'system']);

    present = false;
    await runTasksRemindersJob(job, new Date(start + 60 * 60_000));
    expect(maintenance.probe).toHaveBeenCalledTimes(3);
    expect(maintenance.run).toHaveBeenCalledTimes(3);

    // A probe that finds nothing keeps the pass out of any scope.
    present = true;
    maintenance.probe.mockResolvedValueOnce(false);
    await runTasksRemindersJob(job, new Date(start + 75 * 60_000));
    expect(maintenance.run).toHaveBeenCalledTimes(3);
  });

  it('asks nothing, opens nothing and runs nothing while Tasks is off', async () => {
    const reminders = pass(TASKS_REMINDERS_SCOPE_REASON);
    const digest = pass(TASKS_DIGEST_SCOPE_REASON);
    const job = createTasksRemindersJob({ isPresent: () => false, reminders: reminders.value, digest: digest.value, maintenance: idle(), rederive: settled(), log: log() });

    await runTasksRemindersJob(job, new Date('2032-01-01T08:00:00Z'));

    for (const p of [reminders, digest]) {
      expect(p.probe).not.toHaveBeenCalled();
      expect(p.run).not.toHaveBeenCalled();
    }
  });

  it('runs a pass inside the system scope only when its probe says there is work', async () => {
    const reminders = pass(TASKS_REMINDERS_SCOPE_REASON, async () => false);
    const digest = pass(TASKS_DIGEST_SCOPE_REASON, async () => true);
    const job = createTasksRemindersJob({ isPresent: () => true, reminders: reminders.value, digest: digest.value, maintenance: idle(), rederive: settled(), log: log() });

    await runTasksRemindersJob(job, new Date('2032-01-01T08:00:00Z'));

    expect(reminders.probe).toHaveBeenCalledTimes(1);
    expect(reminders.run).not.toHaveBeenCalled();
    expect(digest.run).toHaveBeenCalledTimes(1);
    expect(digest.scopes).toEqual(['system']);
  });

  it('counts a probe that cannot answer as work', async () => {
    const reminders = pass(TASKS_REMINDERS_SCOPE_REASON, async () => {
      throw new Error('no database');
    });
    const job = createTasksRemindersJob({
      isPresent: () => true,
      reminders: reminders.value,
      digest: pass(TASKS_DIGEST_SCOPE_REASON, async () => false).value,
      maintenance: idle(),
      rederive: settled(),
      log: log(),
    });
    await runTasksRemindersJob(job, new Date('2032-01-01T08:00:00Z'));
    expect(reminders.run).toHaveBeenCalledTimes(1);
  });

  it('runs the reminders every tick and the digest when fifteen minutes have passed since its last pass', async () => {
    const reminders = pass(TASKS_REMINDERS_SCOPE_REASON);
    const digest = pass(TASKS_DIGEST_SCOPE_REASON);
    const job = createTasksRemindersJob({ isPresent: () => true, reminders: reminders.value, digest: digest.value, maintenance: idle(), rederive: settled(), log: log() });
    const start = Date.parse('2032-01-01T08:00:00Z');

    for (let minute = 0; minute <= 30; minute += 1) await runTasksRemindersJob(job, new Date(start + minute * 60_000));

    expect(reminders.run).toHaveBeenCalledTimes(31);
    expect(digest.run.mock.calls.map(([now]) => (now.getTime() - start) / 60_000)).toEqual([0, 15, 30]);
  });

  it('logs a failed pass and goes on — the next tick is the retry — but never absorbs a module switched off', async () => {
    const failing = pass(TASKS_REMINDERS_SCOPE_REASON);
    failing.run.mockRejectedValueOnce(new Error('boom'));
    const digest = pass(TASKS_DIGEST_SCOPE_REASON);
    const logger = log();
    const job = createTasksRemindersJob({ isPresent: () => true, reminders: failing.value, digest: digest.value, maintenance: idle(), rederive: settled(), log: logger });

    await runTasksRemindersJob(job, new Date('2032-01-01T08:00:00Z'));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(digest.run).toHaveBeenCalledTimes(1);

    failing.run.mockRejectedValueOnce(new ModuleDisabledError('tasks'));
    await expect(runTasksRemindersJob(job, new Date('2032-01-01T08:01:00Z'))).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('re-derives in the Tasks time zone first on every tick, in the system scope, and not at all while Tasks is off (#505)', async () => {
    const order: string[] = [];
    const tracked = (reason: string, hasWork: () => Promise<boolean> = async () => true) => {
      const p = pass(reason, hasWork);
      p.run.mockImplementation(async () => {
        order.push(reason);
        p.scopes.push(getTenantContext()?.actor.kind);
      });
      return p;
    };
    const rederive = tracked(TASKS_REDERIVE_SCOPE_REASON);
    const reminders = tracked(TASKS_REMINDERS_SCOPE_REASON);
    let present = true;
    const job = createTasksRemindersJob({
      isPresent: () => present,
      reminders: reminders.value,
      digest: pass(TASKS_DIGEST_SCOPE_REASON, async () => false).value,
      maintenance: idle(),
      rederive: rederive.value,
      log: log(),
    });
    const start = Date.parse('2032-01-01T08:00:00Z');

    for (let minute = 0; minute < 3; minute += 1) await runTasksRemindersJob(job, new Date(start + minute * 60_000));
    // Before the reminders, so a reminder the zone moved is not sent at its old moment.
    expect(order).toEqual([
      TASKS_REDERIVE_SCOPE_REASON,
      TASKS_REMINDERS_SCOPE_REASON,
      TASKS_REDERIVE_SCOPE_REASON,
      TASKS_REMINDERS_SCOPE_REASON,
      TASKS_REDERIVE_SCOPE_REASON,
      TASKS_REMINDERS_SCOPE_REASON,
    ]);
    expect(rederive.scopes).toEqual(['system', 'system', 'system']);

    present = false;
    await runTasksRemindersJob(job, new Date(start + 3 * 60_000));
    expect(rederive.probe).toHaveBeenCalledTimes(3);

    // Nothing drifted: no scope opened.
    present = true;
    rederive.probe.mockResolvedValueOnce(false);
    await runTasksRemindersJob(job, new Date(start + 4 * 60_000));
    expect(rederive.run).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['the process runs none', { processRunsWorkers: false, moduleQueueRedis: {} as never }],
    ['the composition offers no connection', { processRunsWorkers: true, moduleQueueRedis: undefined }],
  ])('builds no consumer and installs no schedule where %s', async (_where, host) => {
    const attach = vi.fn();
    const onClose = vi.fn();
    const job = createTasksRemindersJob({
      isPresent: () => true,
      reminders: pass(TASKS_REMINDERS_SCOPE_REASON).value,
      digest: pass(TASKS_DIGEST_SCOPE_REASON).value,
      maintenance: idle(),
      rederive: settled(),
      log: log(),
    });
    expect(await startTasksReminders({ job, attach, onClose, ...host })).toBe(false);
    expect(attach).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('where the process consumes queues: one consumer through the seam, one tick at a time, the schedule installed', async () => {
    bull.queues.length = 0;
    bull.workers.length = 0;
    const attach = vi.fn();
    const closers: Array<() => Promise<void>> = [];
    const reminders = pass(TASKS_REMINDERS_SCOPE_REASON);
    const job = createTasksRemindersJob({
      isPresent: () => true,
      reminders: reminders.value,
      digest: pass(TASKS_DIGEST_SCOPE_REASON).value,
      maintenance: idle(),
      rederive: settled(),
      log: log(),
    });

    const started = await startTasksReminders({
      job,
      processRunsWorkers: true,
      moduleQueueRedis: {} as never,
      attach,
      onClose: (close) => closers.push(close),
    });

    expect(started).toBe(true);
    expect(bull.workers).toHaveLength(1);
    expect(bull.workers[0]!.name).toBe(TASKS_REMINDERS_QUEUE);
    expect(bull.workers[0]!.options).toMatchObject({ concurrency: 1 });
    expect(attach).toHaveBeenCalledWith(bull.workers[0]);
    expect(bull.queues[0]!.upsertJobScheduler).toHaveBeenCalledWith(
      TASKS_REMINDERS_SCHEDULER_ID,
      { every: TASKS_REMINDERS_EVERY_MS },
      { name: 'sweep', data: {} },
    );
    await bull.workers[0]!.processor();
    expect(reminders.run).toHaveBeenCalledTimes(1);
    await closers[0]!();
    expect(bull.queues[0]!.close).toHaveBeenCalled();
  });
});
