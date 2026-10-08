import { describe, expect, it, vi } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import {
  ensureEventReminderSchedule,
  eventReminderTick,
  EVENT_REMINDER_EVERY_MS,
  EVENT_REMINDER_QUEUE,
  EVENT_REMINDER_SCHEDULER_ID,
  startEventReminders,
} from './event-reminder-worker.js';

/**
 * BullMQ, stood in for: what is held here is what this module hands it — the
 * queue's name, the schedule, the one-at-a-time consumer — not what it does
 * with them, and a unit test opens no connection.
 */
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

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

describe('crm event reminder worker', () => {
  it('names a queue BullMQ accepts', () => {
    expect(EVENT_REMINDER_QUEUE).toBe('crm-event-reminders');
    expect(EVENT_REMINDER_QUEUE).not.toContain(':');
  });

  it.each([
    ['the process runs none', { processRunsWorkers: false, moduleQueueRedis: {} as never }],
    ['the composition offers no connection', { processRunsWorkers: true, moduleQueueRedis: undefined }],
  ])('builds no consumer and installs no schedule where %s', async (_where, host) => {
    const attach = vi.fn();
    const onClose = vi.fn();
    const started = await startEventReminders({ tick: async () => undefined, attach, onClose, ...host });
    expect(started).toBe(false);
    expect(attach).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('where the process consumes queues: one consumer through the seam, one tick at a time, and the schedule installed', async () => {
    bull.queues.length = 0;
    bull.workers.length = 0;
    const attach = vi.fn();
    const closers: Array<() => Promise<void>> = [];
    const tick = vi.fn(async () => undefined);
    const redis = {} as never;

    const started = await startEventReminders({
      tick,
      processRunsWorkers: true,
      moduleQueueRedis: redis,
      attach,
      onClose: (close) => closers.push(close),
    });

    expect(started).toBe(true);
    expect(bull.queues.map((queue) => queue.name)).toEqual([EVENT_REMINDER_QUEUE]);
    expect(bull.workers.map((worker) => worker.name)).toEqual([EVENT_REMINDER_QUEUE]);
    // The consumer reaches the platform's worker seam, which is what stops it with the module.
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith(bull.workers[0]);
    expect(bull.workers[0]?.options).toMatchObject({ connection: redis, concurrency: 1 });
    // Without the schedule nothing ever ticks: no reminder would be delivered at all.
    expect(bull.queues[0]?.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(bull.queues[0]?.upsertJobScheduler).toHaveBeenCalledWith(
      EVENT_REMINDER_SCHEDULER_ID,
      { every: EVENT_REMINDER_EVERY_MS },
      { name: 'sweep', data: {} },
    );
    // What BullMQ invokes is the tick, and nothing but it.
    await bull.workers[0]?.processor();
    expect(tick).toHaveBeenCalledTimes(1);
    // The queue's own connection is closed with the application.
    expect(closers).toHaveLength(1);
    await closers[0]?.();
    expect(bull.queues[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('installs one schedule, every sixty seconds, whose job carries nothing', async () => {
    const upsertJobScheduler = vi.fn(async () => undefined);
    await ensureEventReminderSchedule({ upsertJobScheduler } as never);
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      EVENT_REMINDER_SCHEDULER_ID,
      { every: EVENT_REMINDER_EVERY_MS },
      { name: 'sweep', data: {} },
    );
    expect(EVENT_REMINDER_EVERY_MS).toBe(60_000);
  });

  it('one tick is one pass', async () => {
    const sweep = vi.fn(async () => ({}) as never);
    await eventReminderTick({ reminders: { sweep }, isPresent: () => true, log: logger() as never })();
    expect(sweep).toHaveBeenCalledTimes(1);
    // The pass reads its own clock: a tick hands it none.
    expect(sweep).toHaveBeenCalledWith();
  });

  it('does nothing at all while the module is off — presence is decided before the work', async () => {
    const sweep = vi.fn(async () => ({}) as never);
    let present = false;
    const tick = eventReminderTick({ reminders: { sweep }, isPresent: () => present, log: logger() as never });
    await tick();
    expect(sweep).not.toHaveBeenCalled();
    present = true;
    await tick();
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('logs a failed pass and does not fail the job — the next tick is the retry', async () => {
    const log = logger();
    const tick = eventReminderTick({
      reminders: {
        sweep: async () => {
          throw new Error('database is away');
        },
      },
      isPresent: () => true,
      log: log as never,
    });
    await expect(tick()).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[0]).toMatchObject({ error: 'database is away' });
  });

  it('never swallows a module switched off underneath a delivery', async () => {
    const log = logger();
    const tick = eventReminderTick({
      reminders: {
        sweep: async () => {
          throw new ModuleDisabledError('admin_notifications');
        },
      },
      isPresent: () => true,
      log: log as never,
    });
    await expect(tick()).rejects.toBeInstanceOf(ModuleDisabledError);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
