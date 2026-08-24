import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import {
  defineModuleWorker,
  resetModuleWorkersForTesting,
} from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';

/**
 * Constitution XVII, against a real BullMQ queue: **a module the business
 * operator switched off consumes nothing, and the jobs that arrive while it is
 * off are still there when it comes back.**
 *
 * The defect this file measures was found while packaging `google_analytics`
 * and reproduced on a running build: after a runtime deactivation — the
 * settings row flipped and `b2b:module:state-changed` published, which is
 * exactly the production path — the module's routes answered 503 and the worker
 * consumed the next job anyway. `pauseWorkersFor` had two call sites, both on
 * the **platform-availability** axis (`orchestrator.disable` and its cascade);
 * the operator-activation axis refreshed the registry cache, published, and
 * paused nothing.
 *
 * Its sibling `worker-presence-at-boot` covers the decision taken at
 * registration and `disable-pauses-workers` the orchestrator's imperative
 * helpers, both with stubs. Neither could see this: the defect is not in what
 * happens at registration or in what the helper does when called, it is that
 * **nothing called anything** on the axis an operator actually drives. So this
 * file uses a real `Queue` and a real `Worker` — the only way "the job was left
 * waiting" is a fact about Redis rather than about a stub — and it drives the
 * flip through the registry cache, which is what the activation route's
 * `propagateActivationChange` installs in this process and what the pub/sub
 * message installs in every other one.
 *
 * The queue name is fixed, so the run starts by obliterating it: a job left
 * behind by a crashed run would otherwise be counted as this one's.
 */

const MODULE_ID = 'fixture_deactivated_queue';
const QUEUE_NAME = 'fixture.deactivation-gate';

describe('a deactivated module stops consuming its queue, and its jobs wait (integration)', () => {
  let connection: Redis;
  let workerConnection: Redis;
  let queue: Queue;
  let worker: Worker;
  const processed: string[] = [];

  const settleUntil = async (ms: number, expected: number): Promise<number> => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && processed.length < expected) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return processed.length;
  };

  /** Waiting **or** prioritised **or** delayed — anywhere but consumed or failed. */
  const stillQueued = async (): Promise<number> => {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
    expect(counts['failed'], 'a job was failed rather than left waiting').toBe(0);
    return (counts['waiting'] ?? 0) + (counts['delayed'] ?? 0) + (counts['active'] ?? 0);
  };

  beforeAll(async () => {
    resetModuleWorkersForTesting();
    registryCache.__setEnabledForTesting([MODULE_ID]);

    const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    connection = new Redis(url, { maxRetriesPerRequest: null });
    workerConnection = new Redis(url, { maxRetriesPerRequest: null });

    queue = new Queue(QUEUE_NAME, { connection });
    await queue.obliterate({ force: true });

    worker = defineModuleWorker(
      MODULE_ID,
      new Worker(
        QUEUE_NAME,
        async (job) => {
          processed.push(String(job.id));
        },
        { connection: workerConnection, concurrency: 1 },
      ),
    );
    await worker.waitUntilReady();
  }, 60_000);

  afterAll(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    await connection?.quit();
    await workerConnection?.quit();
    resetModuleWorkersForTesting();
    registryCache.__setEnabledForTesting([]);
  });

  it('consumes while both axes are on — the positive case a quiet interval is read against', async () => {
    await queue.add('deliver', { n: 1 });
    expect(await settleUntil(10_000, 1)).toBe(1);
  }, 30_000);

  it('stops consuming the moment the operator deactivates it, and leaves the job waiting', async () => {
    // The production flip, minus the transport: the settings row is written by
    // the Command and the registry cache is re-read. Every process does this on
    // the pub/sub message, which is why the gate works in one that never ran
    // the orchestrator.
    registryCache.__setEnabledForTesting([MODULE_ID], { deactivated: [MODULE_ID] });

    const before = processed.length;
    await queue.add('deliver', { n: 2 });
    // Well past the time the worker took above; the case above is what makes a
    // quiet interval mean "switched off" rather than "slow".
    await settleUntil(3_000, before + 1);

    expect(processed.length, 'a deactivated module consumed a job').toBe(before);
    expect(await stillQueued(), 'the job was neither consumed nor left waiting').toBe(1);
  }, 30_000);

  it('drains it on reactivation — off is non-destructive and reversible', async () => {
    const before = processed.length;
    registryCache.__setEnabledForTesting([MODULE_ID]);

    expect(await settleUntil(10_000, before + 1)).toBe(before + 1);
    expect(await stillQueued()).toBe(0);
  }, 30_000);

  it('and stops again when the platform withdraws the module, not only the operator', async () => {
    registryCache.__setEnabledForTesting([]);

    const before = processed.length;
    await queue.add('deliver', { n: 3 });
    await settleUntil(3_000, before + 1);

    expect(processed.length).toBe(before);
    expect(await stillQueued()).toBe(1);

    registryCache.__setEnabledForTesting([MODULE_ID]);
    expect(await settleUntil(10_000, before + 1)).toBe(before + 1);
  }, 30_000);
});
