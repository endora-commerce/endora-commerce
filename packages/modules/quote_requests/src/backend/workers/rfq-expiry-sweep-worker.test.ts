import { describe, expect, it, vi } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import {
  ensureRfqExpirySweepSchedule,
  runRfqExpirySweepTick,
  RFQ_EXPIRY_SWEEP_EVERY_MS,
  RFQ_EXPIRY_SWEEP_QUEUE,
  RFQ_EXPIRY_SWEEP_SCHEDULER_ID,
  startRfqExpirySweep,
} from './rfq-expiry-sweep-worker.js';

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
const nothing = { expiredCount: 0, failedCount: 0, notificationsSuppressedCount: 0, reachedBatchLimit: false };

describe('quote_requests expiry sweep worker', () => {
  it('names a queue BullMQ accepts, and fires every thirty minutes', () => {
    expect(RFQ_EXPIRY_SWEEP_QUEUE).toBe('quote_requests.expiry.sweep');
    expect(RFQ_EXPIRY_SWEEP_QUEUE).not.toContain(':');
    expect(RFQ_EXPIRY_SWEEP_EVERY_MS).toBe(30 * 60 * 1000);
  });

  it.each([
    ['the process runs none', { processRunsWorkers: false, moduleQueueRedis: {} as never }],
    ['the composition offers no connection', { processRunsWorkers: true, moduleQueueRedis: undefined }],
  ])('builds no consumer and installs no schedule where %s', async (_where, host) => {
    const attach = vi.fn();
    const onClose = vi.fn();
    const started = await startRfqExpirySweep({
      expiry: { hasExpirable: async () => false, sweepInScope: async () => nothing },
      log: logger(),
      attach,
      onClose,
      ...host,
    });
    expect(started).toBe(false);
    expect(attach).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('where the process consumes queues: one consumer through the seam, one tick at a time, and the schedule installed', async () => {
    bull.queues.length = 0;
    bull.workers.length = 0;
    const attach = vi.fn();
    const closers: Array<() => Promise<void>> = [];

    const started = await startRfqExpirySweep({
      expiry: { hasExpirable: async () => false, sweepInScope: async () => nothing },
      log: logger(),
      processRunsWorkers: true,
      moduleQueueRedis: {} as never,
      attach,
      onClose: (close) => closers.push(close),
    });

    expect(started).toBe(true);
    expect(bull.queues.map((queue) => queue.name)).toEqual([RFQ_EXPIRY_SWEEP_QUEUE]);
    expect(bull.workers.map((worker) => worker.name)).toEqual([RFQ_EXPIRY_SWEEP_QUEUE]);
    // The consumer reaches the platform's worker seam, which is what stops it with the module.
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith(bull.workers[0]);
    expect(bull.workers[0]?.options).toMatchObject({ concurrency: 1 });
    expect(bull.queues[0]?.upsertJobScheduler).toHaveBeenCalledWith(
      RFQ_EXPIRY_SWEEP_SCHEDULER_ID,
      { every: RFQ_EXPIRY_SWEEP_EVERY_MS },
      { name: 'sweep', data: {} },
    );
    // The queue closes with the application.
    expect(closers).toHaveLength(1);
    await closers[0]?.();
    expect(bull.queues[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('the schedule is one module-wide scheduler whose job carries no data', async () => {
    const upsertJobScheduler = vi.fn(async () => undefined);
    await ensureRfqExpirySweepSchedule({ upsertJobScheduler } as never);
    expect(upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(upsertJobScheduler.mock.calls[0]).toEqual([
      'quote_requests.expiry.sweep',
      { every: 1_800_000 },
      { name: 'sweep', data: {} },
    ]);
  });

  describe('one tick', () => {
    it('with nothing due it asks, and runs no pass', async () => {
      const hasExpirable = vi.fn(async () => false);
      const sweepInScope = vi.fn(async () => nothing);
      await runRfqExpirySweepTick({ expiry: { hasExpirable, sweepInScope }, log: logger() });
      expect(hasExpirable).toHaveBeenCalledTimes(1);
      expect(sweepInScope).not.toHaveBeenCalled();
    });

    it('with something due it runs one pass and says what it did', async () => {
      const log = logger();
      const result = { expiredCount: 3, failedCount: 1, notificationsSuppressedCount: 2, reachedBatchLimit: true };
      const sweepInScope = vi.fn(async () => result);
      await runRfqExpirySweepTick({ expiry: { hasExpirable: async () => true, sweepInScope }, log });
      expect(sweepInScope).toHaveBeenCalledTimes(1);
      expect(log.info).toHaveBeenCalledTimes(1);
      expect(log.info.mock.calls[0]?.[0]).toEqual(result);
    });

    it('a failed pass is logged and does not fail the job — the next tick is the retry', async () => {
      const log = logger();
      const tick = () =>
        runRfqExpirySweepTick({
          expiry: {
            hasExpirable: async () => true,
            sweepInScope: async () => {
              throw new Error('database went away');
            },
          },
          log,
        });
      await expect(tick()).resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn.mock.calls[0]?.[0]).toEqual({ error: 'database went away' });
    });

    it('a module switched off underneath the pass is never swallowed', async () => {
      const tick = () =>
        runRfqExpirySweepTick({
          expiry: {
            hasExpirable: async () => true,
            sweepInScope: async () => {
              throw new ModuleDisabledError('organizations');
            },
          },
          log: logger(),
        });
      await expect(tick()).rejects.toBeInstanceOf(ModuleDisabledError);
    });

    it('a question that cannot be answered counts as yes: the pass runs', async () => {
      const sweepInScope = vi.fn(async () => nothing);
      await runRfqExpirySweepTick({
        expiry: {
          hasExpirable: async () => {
            throw new Error('the probe could not read');
          },
          sweepInScope,
        },
        log: logger(),
      });
      expect(sweepInScope).toHaveBeenCalledTimes(1);
    });

    it('a module switched off under the question is not a failed question', async () => {
      const sweepInScope = vi.fn(async () => nothing);
      await expect(
        runRfqExpirySweepTick({
          expiry: {
            hasExpirable: async () => {
              throw new ModuleDisabledError('settings');
            },
            sweepInScope,
          },
          log: logger(),
        }),
      ).rejects.toBeInstanceOf(ModuleDisabledError);
      expect(sweepInScope).not.toHaveBeenCalled();
    });
  });
});
