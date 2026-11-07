import { describe, expect, it, vi } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import {
  ANONYMIZATION_SWEEP_EVERY_MS,
  ANONYMIZATION_SWEEP_QUEUE,
  ANONYMIZATION_SWEEP_SCHEDULER_ID,
  ANONYMIZATION_SWEEP_SCOPE_REASON,
  AnonymizationSweepWorker,
  ensureAnonymizationSweepSchedule,
  runAnonymizationSweepTick,
  startAnonymizationSweep,
} from './anonymization-sweep-worker.js';

/**
 * Issue #677 — the retention sweep's clock, unit half.
 *
 * `AnonymizationSweepWorker.sweep()` was built and exposed on the module's
 * handle, and nothing called it. What is held here is what this module hands
 * BullMQ — the queue's name, the schedule under its stable id, the
 * one-at-a-time consumer through the platform's worker seam — and what one tick
 * does. BullMQ is stood in for: a unit test opens no connection. The scheduled
 * job end to end is `backend/test/integration/customers/anonymization-schedule.test.ts`.
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

describe('customers anonymization sweep schedule (#677)', () => {
  it('names a queue BullMQ accepts, and fires once a day', () => {
    expect(ANONYMIZATION_SWEEP_QUEUE).toBe('customers.anonymization.sweep');
    expect(ANONYMIZATION_SWEEP_QUEUE).not.toContain(':');
    expect(ANONYMIZATION_SWEEP_SCHEDULER_ID).not.toContain(':');
    expect(ANONYMIZATION_SWEEP_EVERY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it.each([
    ['the process runs none', { processRunsWorkers: false, moduleQueueRedis: {} as never }],
    ['the composition offers no connection', { processRunsWorkers: true, moduleQueueRedis: undefined }],
  ])('builds no consumer and installs no schedule where %s', async (_where, host) => {
    bull.queues.length = 0;
    bull.workers.length = 0;
    const attach = vi.fn();
    const onClose = vi.fn();
    const started = await startAnonymizationSweep({
      sweeper: { hasDue: async () => false, sweep: async () => 0 },
      log: logger(),
      attach,
      onClose,
      ...host,
    });
    expect(started).toBe(false);
    expect(attach).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(bull.queues).toEqual([]);
    expect(bull.workers).toEqual([]);
  });

  it('where the process consumes queues: one consumer through the seam, one tick at a time, and the schedule installed', async () => {
    bull.queues.length = 0;
    bull.workers.length = 0;
    const attach = vi.fn();
    const closers: Array<() => Promise<void>> = [];

    const started = await startAnonymizationSweep({
      sweeper: { hasDue: async () => false, sweep: async () => 0 },
      log: logger(),
      processRunsWorkers: true,
      moduleQueueRedis: {} as never,
      attach,
      onClose: (close) => closers.push(close),
    });

    expect(started).toBe(true);
    expect(bull.queues.map((queue) => queue.name)).toEqual([ANONYMIZATION_SWEEP_QUEUE]);
    expect(bull.workers.map((worker) => worker.name)).toEqual([ANONYMIZATION_SWEEP_QUEUE]);
    // The consumer reaches the platform's worker seam, which is what stops it with the module.
    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledWith(bull.workers[0]);
    expect(bull.workers[0]?.options).toMatchObject({ concurrency: 1 });
    expect(bull.queues[0]?.upsertJobScheduler).toHaveBeenCalledWith(
      ANONYMIZATION_SWEEP_SCHEDULER_ID,
      { every: ANONYMIZATION_SWEEP_EVERY_MS },
      { name: 'sweep', data: {} },
    );
    // The queue closes with the application.
    expect(closers).toHaveLength(1);
    await closers[0]?.();
    expect(bull.queues[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('the schedule is one module-wide scheduler under a stable id, so every boot of every replica upserts the same one', async () => {
    const upsertJobScheduler = vi.fn(async () => undefined);
    await ensureAnonymizationSweepSchedule({ upsertJobScheduler } as never);
    await ensureAnonymizationSweepSchedule({ upsertJobScheduler } as never);
    expect(upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(upsertJobScheduler.mock.calls[0]).toEqual([
      'customers.anonymization.sweep',
      { every: 86_400_000 },
      { name: 'sweep', data: {} },
    ]);
    expect(upsertJobScheduler.mock.calls[1]).toEqual(upsertJobScheduler.mock.calls[0]);
  });

  describe('one tick', () => {
    it('runs one sweep inside a system scope and says what it did', async () => {
      const log = logger();
      let mode: string | undefined;
      const sweep = vi.fn(async () => {
        mode = getTenantContext()?.mode;
        return 3;
      });
      await runAnonymizationSweepTick({ sweeper: { hasDue: async () => true, sweep }, log });
      expect(sweep).toHaveBeenCalledTimes(1);
      expect(mode).toBe('system');
      expect(ANONYMIZATION_SWEEP_SCOPE_REASON).toContain('customers');
      expect(log.info).toHaveBeenCalledWith({ anonymized: 3 }, expect.any(String));
    });

    it('logs nothing when nothing was due', async () => {
      const log = logger();
      await runAnonymizationSweepTick({ sweeper: { hasDue: async () => true, sweep: async () => 0 }, log });
      expect(log.info).not.toHaveBeenCalled();
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('a failed sweep is logged and fails the job, so the tick is recorded as failed; the next tick retries', async () => {
      const log = logger();
      const tick = () =>
        runAnonymizationSweepTick({
          sweeper: {
            hasDue: async () => true,
            sweep: async () => {
              throw new Error('Anonymization sweep failed for 1 of 2 account(s): a');
            },
          },
          log,
        });
      await expect(tick()).rejects.toThrow('Anonymization sweep failed');
      expect(log.warn).toHaveBeenCalledTimes(1);
      expect(log.warn.mock.calls[0]?.[0]).toEqual({ error: 'Anonymization sweep failed for 1 of 2 account(s): a' });
    });

    it('a module switched off underneath the sweep is rethrown as it is', async () => {
      const log = logger();
      await expect(
        runAnonymizationSweepTick({
          sweeper: {
            hasDue: async () => true,
            sweep: async () => {
              throw new ModuleDisabledError('organizations');
            },
          },
          log,
        }),
      ).rejects.toBeInstanceOf(ModuleDisabledError);
      expect(log.warn).not.toHaveBeenCalled();
    });
  });

  /**
   * Issue #857 — an idle tick enters no scope. Entering the system scope is
   * what writes the `tenant.escape_hatch` audit row, so a daily tick with no
   * account due asks first (`docs/docs/architecture/tenant-scoping.md` §
   * *A scheduled tick with nothing to do enters no scope*).
   */
  describe('the question before the scope (#857)', () => {
    it('with nothing due it asks, outside any system scope, and runs no sweep', async () => {
      let modeWhileAsking: string | undefined = 'unset';
      const hasDue = vi.fn(async () => {
        modeWhileAsking = getTenantContext()?.mode;
        return false;
      });
      const sweep = vi.fn(async () => 0);
      const log = logger();
      await runAnonymizationSweepTick({ sweeper: { hasDue, sweep }, log });
      expect(hasDue).toHaveBeenCalledTimes(1);
      expect(modeWhileAsking).not.toBe('system');
      expect(sweep).not.toHaveBeenCalled();
      expect(log.info).not.toHaveBeenCalled();
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('with something due it runs the sweep inside the system scope', async () => {
      let mode: string | undefined;
      const sweep = vi.fn(async () => {
        mode = getTenantContext()?.mode;
        return 1;
      });
      await runAnonymizationSweepTick({ sweeper: { hasDue: async () => true, sweep }, log: logger() });
      expect(sweep).toHaveBeenCalledTimes(1);
      expect(mode).toBe('system');
    });

    it('a question that cannot be answered counts as yes: the sweep runs', async () => {
      const sweep = vi.fn(async () => 0);
      await runAnonymizationSweepTick({
        sweeper: {
          hasDue: async () => {
            throw new Error('the probe could not read');
          },
          sweep,
        },
        log: logger(),
      });
      expect(sweep).toHaveBeenCalledTimes(1);
    });

    it('a module switched off under the question is not a failed question', async () => {
      const sweep = vi.fn(async () => 0);
      await expect(
        runAnonymizationSweepTick({
          sweeper: {
            hasDue: async () => {
              throw new ModuleDisabledError('settings');
            },
            sweep,
          },
          log: logger(),
        }),
      ).rejects.toBeInstanceOf(ModuleDisabledError);
      expect(sweep).not.toHaveBeenCalled();
    });
  });

  describe('AnonymizationSweepWorker.hasDue (#857)', () => {
    it('asks the owner of the table with the cutoff the sweep would use', async () => {
      const now = new Date('2026-11-07T12:00:00.000Z');
      const deletion = { hasDue: vi.fn(async () => true), sweep: vi.fn(async () => 0) };
      const worker = new AnonymizationSweepWorker(deletion as never, async () => 30);
      expect(await worker.hasDue(now)).toBe(true);
      expect(deletion.hasDue).toHaveBeenCalledWith(30, now);
      expect(deletion.sweep).not.toHaveBeenCalled();
    });
  });
});
