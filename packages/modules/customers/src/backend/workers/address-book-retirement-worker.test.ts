import { describe, expect, it, vi } from 'vitest';
import {
  ADDRESS_BOOK_RETIREMENT_JOB_ID,
  ADDRESS_BOOK_RETIREMENT_QUEUE,
  runAddressBookRetirementJob,
  startAddressBookRetirement,
} from './address-book-retirement-worker.js';

/**
 * `specs/173-b2c-address-book-merge/` R-1 and T-O1 (unit half) — the release-1
 * retirement job's BullMQ wiring.
 *
 * One job under a fixed id, enqueued at every boot of a worker process: BullMQ
 * keeps one job per id, so several processes booting together produce one run,
 * and a finished job is removed so that the next boot enqueues it again and
 * finds nothing to do. The consumer goes through the platform's worker seam
 * (`ctx.worker`), which is what stops it while `customers` is switched off and
 * lets it drain once the module is back. BullMQ is stood in for: a unit test
 * opens no connection.
 */
const bull = vi.hoisted(() => ({
  queues: [] as Array<{
    name: string;
    options: Record<string, unknown>;
    add: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }>,
  workers: [] as Array<{ name: string; processor: () => Promise<unknown>; options: Record<string, unknown> }>,
}));
vi.mock('bullmq', () => ({
  Queue: class {
    readonly add = vi.fn(async () => undefined);
    readonly close = vi.fn(async () => undefined);
    constructor(
      readonly name: string,
      readonly options: Record<string, unknown>,
    ) {
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
const nothing = { accounts: 0, moved: 0, deduplicated: 0, erased: 0, refused: 0 };

describe('customers address-book retirement job', () => {
  it('names a queue and a fixed job id BullMQ accepts', () => {
    expect(ADDRESS_BOOK_RETIREMENT_QUEUE).not.toContain(':');
    // BullMQ refuses a custom id with a single `:` ("Custom Id cannot contain :").
    expect(ADDRESS_BOOK_RETIREMENT_JOB_ID).toBe('customers.address-book-retirement');
  });

  it.each([
    ['the process runs none', { processRunsWorkers: false, moduleQueueRedis: {} as never }],
    ['the composition offers no connection', { processRunsWorkers: true, moduleQueueRedis: undefined }],
  ])('builds no consumer and enqueues nothing where %s', async (_where, host) => {
    const attach = vi.fn();
    const onClose = vi.fn();
    const started = await startAddressBookRetirement({
      retirement: { hasWork: async () => true, runInScope: async () => nothing },
      log: logger(),
      attach,
      onClose,
      ...host,
    });
    expect(started).toBe(false);
    expect(attach).not.toHaveBeenCalled();
  });

  it('where the process consumes queues: one consumer through the seam, and the one job enqueued under its fixed id', async () => {
    bull.queues.length = 0;
    bull.workers.length = 0;
    const attach = vi.fn();
    const closers: Array<() => Promise<void>> = [];

    const started = await startAddressBookRetirement({
      retirement: { hasWork: async () => true, runInScope: async () => nothing },
      log: logger(),
      processRunsWorkers: true,
      moduleQueueRedis: {} as never,
      attach,
      onClose: (close) => closers.push(close),
    });

    expect(started).toBe(true);
    expect(bull.workers.map((w) => w.name)).toEqual([ADDRESS_BOOK_RETIREMENT_QUEUE]);
    expect(attach).toHaveBeenCalledWith(bull.workers[0]);
    expect(bull.workers[0]?.options).toMatchObject({ concurrency: 1 });
    const queue = bull.queues[0]!;
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, data, options] = queue.add.mock.calls[0]!;
    expect(data).toEqual({});
    // Removed once settled, so the next boot enqueues it again and finds
    // nothing — and a failed run does not block every later boot's retry.
    expect(options).toMatchObject({
      jobId: ADDRESS_BOOK_RETIREMENT_JOB_ID,
      removeOnComplete: true,
      removeOnFail: true,
    });
    expect(closers).toHaveLength(1);
    await closers[0]?.();
    expect(queue.close).toHaveBeenCalledTimes(1);
  });

  describe('one run', () => {
    it('with nothing left it asks and enters no scope', async () => {
      const runInScope = vi.fn(async () => nothing);
      const enter = vi.fn();
      await runAddressBookRetirementJob({ retirement: { hasWork: async () => false, runInScope }, log: logger() }, enter);
      expect(runInScope).not.toHaveBeenCalled();
      expect(enter).not.toHaveBeenCalled();
    });

    it('with rows left it runs inside a system scope and logs the summary', async () => {
      const log = logger();
      const result = { accounts: 2, moved: 3, deduplicated: 1, erased: 1, refused: 1 };
      const runInScope = vi.fn(async () => result);
      const reasons: string[] = [];
      await runAddressBookRetirementJob(
        { retirement: { hasWork: async () => true, runInScope }, log },
        async (reason, fn) => {
          reasons.push(reason);
          return fn();
        },
      );
      expect(runInScope).toHaveBeenCalledTimes(1);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain('#762');
      expect(log.info).toHaveBeenCalledWith(result, expect.any(String));
    });

    it('a failed run fails the job, so BullMQ retries it', async () => {
      await expect(
        runAddressBookRetirementJob(
          {
            retirement: {
              hasWork: async () => true,
              runInScope: async () => {
                throw new Error('database went away');
              },
            },
            log: logger(),
          },
          async (_reason, fn) => fn(),
        ),
      ).rejects.toThrow('database went away');
    });
  });
});
