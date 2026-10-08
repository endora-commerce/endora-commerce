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
