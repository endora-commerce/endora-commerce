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
  PUBLICATION_WINDOW_SWEEP_EVERY_MS,
  PUBLICATION_WINDOW_SWEEP_QUEUE,
  PUBLICATION_WINDOW_SWEEP_SCHEDULER_ID,
  startPublicationWindowSweep,
} from '../../../../packages/modules/catalog/dist/backend/services/publication-window-sweep.js';

/**
 * Feature 163 (R9, FR-024), final QA Q-L1 — the publication-window sweep runs on its
 * schedule. `publication-window-sweep.test.ts` drives `sweep()` by hand; here nothing
 * calls it: `startPublicationWindowSweep` installs the Job Scheduler (every five
 * minutes) on a real Redis and attaches the consumer through the platform's worker
 * seam (`defineModuleWorker`, what `ctx.worker` applies), and a tick on the queue is
 * what runs the sweep.
 *
 * `catalog` declares itself non-deactivatable, so its only off state is the platform
 * axis: there no tick runs, and the tick that waited runs once it is back.
 *
 * The queue lives under a key prefix of this run's own, because the Redis is shared
 * with every other run on the machine (the quote-request expiry schedule's shape).
 */
describe('catalog — the publication-window sweep runs on its schedule [integration]', () => {
  let h: BackendServerHandle;
  let redis: Redis;
  let queue: Queue;
  let worker: Worker | undefined;
  const closers: Array<() => Promise<void>> = [];
  const prefix = `pw-sweep-test-${randomUUID().slice(0, 8)}`;
  const completed: string[] = [];
  let sweeps = 0;

  const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;

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
    queue = new Queue(PUBLICATION_WINDOW_SWEEP_QUEUE, { connection: redis, prefix });
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
    const sweep = {
      hasDueTransitions: async () => true,
      sweep: async () => ({ from: new Date(), to: new Date(), productIds: [] }),
    } as never;
    const onClose = (): void => undefined;
    expect(await startPublicationWindowSweep({ processRunsWorkers: false, moduleQueueRedis: redis, sweep, log, attach, onClose, queuePrefix: prefix })).toBe(false);
    expect(await startPublicationWindowSweep({ processRunsWorkers: true, moduleQueueRedis: undefined, sweep, log, attach, onClose, queuePrefix: prefix })).toBe(false);
    expect(await queue.getJobSchedulers()).toEqual([]);
  });

  it('installs one scheduler every five minutes, and a tick runs the sweep', async () => {
    const started = await startPublicationWindowSweep({
      processRunsWorkers: true,
      moduleQueueRedis: redis,
      queuePrefix: prefix,
      sweep: {
        // Something is always due here: what this file holds is the schedule,
        // and the question is held by the unit and audit tests (#894).
        hasDueTransitions: async () => true,
        sweep: async () => {
          sweeps += 1;
          return { from: new Date(), to: new Date(), productIds: [] };
        },
      } as never,
      log,
      attach: (built) => {
        worker = defineModuleWorker('catalog', built);
        built.on('completed', (job) => {
          completed.push(job.id ?? '');
        });
      },
      onClose: (close) => closers.push(close),
    });
    expect(started).toBe(true);
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((scheduler) => scheduler.key)).toEqual([PUBLICATION_WINDOW_SWEEP_SCHEDULER_ID]);
    expect(Number(schedulers[0]!.every)).toBe(PUBLICATION_WINDOW_SWEEP_EVERY_MS);
    expect(PUBLICATION_WINDOW_SWEEP_EVERY_MS).toBe(5 * 60 * 1000);

    // The scheduler's first job, then one more tick put on the queue by hand.
    expect(await until(() => sweeps >= 1, 30_000), 'the scheduled job ran the sweep').toBe(true);
    const before = sweeps;
    const job = await queue.add('sweep', {});
    expect(await until(() => completed.includes(job.id ?? ''), 30_000)).toBe(true);
    expect(sweeps).toBe(before + 1);
  }, 120_000);

  it('with catalog platform-unavailable no tick runs, and the waiting tick runs once it is back', async () => {
    expect(worker, 'the previous case started the consumer').toBeDefined();
    const before = sweeps;
    let job: { id?: string | undefined } = {};
    await withModuleOff('catalog', 'platform-unavailable', async () => {
      job = await queue.add('sweep', {});
      // Long enough for a running consumer to have taken it many times over.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(completed).not.toContain(job.id);
      expect(sweeps).toBe(before);
    });
    expect(await until(() => completed.includes(job.id ?? ''), 60_000)).toBe(true);
    expect(sweeps).toBe(before + 1);
  }, 120_000);
});
