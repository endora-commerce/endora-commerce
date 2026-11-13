import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import {
  CUSTOMER_NOTIFICATIONS_RETENTION_EVERY_MS,
  CUSTOMER_NOTIFICATIONS_RETENTION_QUEUE,
  CUSTOMER_NOTIFICATIONS_RETENTION_SCHEDULER_ID,
  CUSTOMER_NOTIFICATIONS_RETENTION_SCOPE_REASON,
  runRetentionSweepTick,
  startRetentionSweep,
  type RetentionSweepDeps,
} from './retention-sweep-worker.js';

/**
 * The retention sweep's clock (`specs/179-rfq-and-customer-notifications/`
 * research R-16, T062): one tick, what it asks before it enters a scope, and
 * what it hands BullMQ. BullMQ and the system scope are stood in for; what the
 * passes delete is `services/retention-sweeper.test.ts`, and against a
 * database `backend/test/integration/customer_notifications/retention.test.ts`.
 */

const scope = vi.hoisted(() => ({ entered: [] as string[] }));
vi.mock('@endora-commerce/platform/kernel', async (importOriginal) => {
  const original = await importOriginal<typeof import('@endora-commerce/platform/kernel')>();
  return {
    ...original,
    enterSystemScope: vi.fn(async (reason: string, fn: () => Promise<unknown>) => {
      scope.entered.push(reason);
      return fn();
    }),
  };
});

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
const swept = { retentionDays: 90, expired: 0, erased: 0 };

function deps(overrides: Partial<RetentionSweepDeps> = {}): RetentionSweepDeps {
  return {
    isPresent: () => true,
    sweeper: { hasWork: vi.fn(async () => true), sweep: vi.fn(async () => swept) },
    log: logger(),
    ...overrides,
  };
}

beforeEach(() => {
  scope.entered.length = 0;
});

describe('customer_notifications retention sweep — one tick', () => {
  it('an idle tick asks outside any scope, enters none and runs no pass', async () => {
    const sweep = vi.fn(async () => swept);
    const hasWork = vi.fn(async () => {
      expect(scope.entered).toEqual([]);
      return false;
    });

    await runRetentionSweepTick(deps({ sweeper: { hasWork, sweep } }));

    expect(hasWork).toHaveBeenCalledTimes(1);
    expect(sweep).not.toHaveBeenCalled();
    expect(scope.entered).toEqual([]);
  });

  it('a busy tick enters the system scope once and sweeps inside it', async () => {
    const sweep = vi.fn(async () => {
      expect(scope.entered).toEqual([CUSTOMER_NOTIFICATIONS_RETENTION_SCOPE_REASON]);
      return { retentionDays: 90, expired: 3, erased: 1 };
    });
    const log = logger();

    await runRetentionSweepTick(deps({ sweeper: { hasWork: async () => true, sweep }, log, now: () => new Date(0) }));

    expect(sweep).toHaveBeenCalledWith(new Date(0));
    expect(scope.entered).toEqual([CUSTOMER_NOTIFICATIONS_RETENTION_SCOPE_REASON]);
    expect(log.info).toHaveBeenCalledWith(
      { retentionDays: 90, expired: 3, erased: 1 },
      'customer_notifications: retention sweep finished',
    );
  });

  it('decides presence first and does nothing at all while the module is off', async () => {
    const hasWork = vi.fn(async () => true);
    const sweep = vi.fn(async () => swept);

    await runRetentionSweepTick(deps({ isPresent: () => false, sweeper: { hasWork, sweep } }));

    expect(hasWork).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
    expect(scope.entered).toEqual([]);
  });

  it('a question that cannot be answered counts as yes', async () => {
    const sweep = vi.fn(async () => swept);

    await runRetentionSweepTick(
      deps({
        sweeper: {
          hasWork: async () => {
            throw new Error('the probe could not read');
          },
          sweep,
        },
      }),
    );

    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('a failed pass is logged and does not fail the job', async () => {
    const log = logger();

    await expect(
      runRetentionSweepTick(
        deps({
          log,
          sweeper: {
            hasWork: async () => true,
            sweep: async () => {
              throw new Error('database went away');
            },
          },
        }),
      ),
    ).resolves.toBeUndefined();

    expect(log.warn).toHaveBeenCalledWith(
      { error: 'database went away' },
      'customer_notifications: the retention sweep failed; the next tick retries',
    );
  });

  it('a module switched off underneath the pass is never swallowed', async () => {
    await expect(
      runRetentionSweepTick(
        deps({
          sweeper: {
            hasWork: async () => true,
            sweep: async () => {
              throw new ModuleDisabledError('customer_accounts');
            },
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});

describe('customer_notifications retention sweep — the consumer', () => {
  it('names a queue BullMQ accepts, and fires once a day', () => {
    expect(CUSTOMER_NOTIFICATIONS_RETENTION_QUEUE).toBe('customer_notifications.retention.sweep');
    expect(CUSTOMER_NOTIFICATIONS_RETENTION_QUEUE).not.toContain(':');
    expect(CUSTOMER_NOTIFICATIONS_RETENTION_EVERY_MS).toBe(24 * 60 * 60 * 1000);
  });

  it.each([
    ['the process runs none', { processRunsWorkers: false, moduleQueueRedis: {} as never }],
    ['the composition offers no connection', { processRunsWorkers: true, moduleQueueRedis: undefined }],
  ])('builds no consumer and installs no schedule where %s', async (_where, host) => {
    const attach = vi.fn();
    const started = await startRetentionSweep({ deps: deps(), attach, onClose: vi.fn(), ...host });
    expect(started).toBe(false);
    expect(attach).not.toHaveBeenCalled();
  });

  it('builds one consumer through the seam, one tick at a time, and installs the daily schedule', async () => {
    bull.queues.length = 0;
    bull.workers.length = 0;
    const attach = vi.fn();
    const closers: Array<() => Promise<void>> = [];

    const started = await startRetentionSweep({
      deps: deps(),
      processRunsWorkers: true,
      moduleQueueRedis: {} as never,
      attach,
      onClose: (close) => closers.push(close),
    });

    expect(started).toBe(true);
    expect(bull.workers.map((worker) => worker.name)).toEqual([CUSTOMER_NOTIFICATIONS_RETENTION_QUEUE]);
    expect(attach).toHaveBeenCalledWith(bull.workers[0]);
    expect(bull.workers[0]?.options).toMatchObject({ concurrency: 1 });
    expect(bull.queues[0]?.upsertJobScheduler).toHaveBeenCalledWith(
      CUSTOMER_NOTIFICATIONS_RETENTION_SCHEDULER_ID,
      { every: CUSTOMER_NOTIFICATIONS_RETENTION_EVERY_MS },
      { name: 'sweep', data: {} },
    );
    await closers[0]?.();
    expect(bull.queues[0]?.close).toHaveBeenCalledTimes(1);
  });
});
