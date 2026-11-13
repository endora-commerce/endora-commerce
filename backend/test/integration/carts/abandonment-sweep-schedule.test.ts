import { randomUUID } from 'node:crypto';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { defineModuleWorker } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import {
  CART_ABANDONMENT_SWEEP_EVERY_MS,
  CART_ABANDONMENT_SWEEP_QUEUE,
  CART_ABANDONMENT_SWEEP_SCHEDULER_ID,
  startCartAbandonmentSweep,
} from '../../../../packages/modules/carts/src/backend/workers/cart-abandonment-sweep-worker.js';

/**
 * Issue #1119 — the cart abandonment sweep runs on its schedule.
 *
 * `cart-abandonment-worker.integration.test.ts` drives `sweep()` and
 * `hasSweepWork()` by hand; here nothing calls them: `startCartAbandonmentSweep`
 * installs the Job Scheduler (every fifteen minutes) on a real Redis and
 * attaches the consumer through the platform's worker seam
 * (`defineModuleWorker`, what `ctx.worker` applies), and a tick on the queue is
 * what runs the pass. That the module's composition makes this same call is
 * held by `packages/modules/carts/src/backend/abandonment-sweep-is-scheduled.test.ts`.
 *
 * `carts` declares itself non-deactivatable, so its only off state is the
 * platform axis: there no tick runs, and the tick that waited runs once it is
 * back.
 *
 * The queue lives under a key prefix of this run's own, because the Redis is
 * shared with every other run on the machine (the quote-request expiry
 * schedule's shape).
 */
describe('carts — the abandonment sweep runs on its schedule [integration]', () => {
  let h: BackendServerHandle;
  let redis: Redis;
  let queue: Queue;
  let worker: Worker | undefined;
  const closers: Array<() => Promise<void>> = [];
  const prefix = `cart-abandonment-test-${randomUUID().slice(0, 8)}`;
  const completed: string[] = [];
  let passes = 0;
  let asked = 0;
  let hasWork = true;

  const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;

  const sweep = {
    hasSweepWork: async () => {
      asked += 1;
      return hasWork;
    },
    sweepInScope: async () => {
      passes += 1;
      return { abandonedCount: 0, notifiedCount: 0, workingBasketsRemoved: 0 };
    },
  };

  const until = async (condition: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return condition();
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
    queue = new Queue(CART_ABANDONMENT_SWEEP_QUEUE, { connection: redis, prefix });
  }, 120_000);

  afterAll(async () => {
    for (const close of closers) await close();
    await worker?.close();
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    redis?.disconnect();
    if (h) await teardownBackendServer(h);
  });

  it('starts nothing where the process consumes no queues or has no connection', async () => {
    const attach = (): void => {
      throw new Error('no consumer may be attached');
    };
    const onClose = (): void => undefined;
    expect(
      await startCartAbandonmentSweep({ processRunsWorkers: false, moduleQueueRedis: redis, sweep, log, attach, onClose, queuePrefix: prefix }),
    ).toBe(false);
    expect(
      await startCartAbandonmentSweep({ processRunsWorkers: true, moduleQueueRedis: undefined, sweep, log, attach, onClose, queuePrefix: prefix }),
    ).toBe(false);
    expect(await queue.getJobSchedulers()).toEqual([]);
  });

  it('installs one scheduler every fifteen minutes, and a tick runs the pass', async () => {
    const started = await startCartAbandonmentSweep({
      processRunsWorkers: true,
      moduleQueueRedis: redis,
      queuePrefix: prefix,
      sweep,
      log,
      attach: (built) => {
        worker = defineModuleWorker('carts', built);
        built.on('completed', (job) => {
          completed.push(job.id ?? '');
        });
      },
      onClose: (close) => closers.push(close),
    });
    expect(started).toBe(true);
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((scheduler) => scheduler.key)).toEqual([CART_ABANDONMENT_SWEEP_SCHEDULER_ID]);
    expect(Number(schedulers[0]!.every)).toBe(CART_ABANDONMENT_SWEEP_EVERY_MS);

    // The scheduler's first job, then one more tick put on the queue by hand.
    expect(await until(() => passes >= 1, 30_000), 'the scheduled job ran the pass').toBe(true);
    const before = passes;
    const job = await queue.add('sweep', {});
    expect(await until(() => completed.includes(job.id ?? ''), 30_000)).toBe(true);
    expect(passes).toBe(before + 1);
  }, 120_000);

  it('a tick with nothing to do asks, and runs no pass', async () => {
    hasWork = false;
    try {
      const beforePasses = passes;
      const beforeAsked = asked;
      const job = await queue.add('sweep', {});
      expect(await until(() => completed.includes(job.id ?? ''), 30_000)).toBe(true);
      expect(asked).toBe(beforeAsked + 1);
      expect(passes).toBe(beforePasses);
    } finally {
      hasWork = true;
    }
  }, 60_000);

  it('with carts platform-unavailable no tick runs, and the waiting tick runs once it is back', async () => {
    expect(worker, 'the earlier case started the consumer').toBeDefined();
    const before = passes;
    let job: { id?: string | undefined } = {};
    await withModuleOff('carts', 'platform-unavailable', async () => {
      job = await queue.add('sweep', {});
      // Long enough for a running consumer to have taken it many times over.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(completed).not.toContain(job.id);
      expect(passes).toBe(before);
    });
    expect(await until(() => completed.includes(job.id ?? ''), 60_000)).toBe(true);
    expect(passes).toBe(before + 1);
  }, 120_000);
});
