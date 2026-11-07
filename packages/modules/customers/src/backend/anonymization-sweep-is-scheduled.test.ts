import { describe, expect, it, vi } from 'vitest';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { registerModule } from './index.js';
import {
  ANONYMIZATION_SWEEP_EVERY_MS,
  ANONYMIZATION_SWEEP_QUEUE,
  ANONYMIZATION_SWEEP_SCHEDULER_ID,
} from './workers/anonymization-sweep-worker.js';

/**
 * Issue #677 — the retention sweep has a caller.
 *
 * `AnonymizationSweepWorker.sweep()` was built, exposed on the module's handle
 * and documented as what scrubs a deleted account after
 * `customers.deletion_retention_days` — and nothing called it. Every test drove
 * `sweep()` by hand, so nothing could notice. This file composes the module
 * **as `registerModule` composes it**, against a recording context, and holds
 * the two facts that make a schedule: a consumer of the sweep's queue handed to
 * the platform's worker seam, and the Job Scheduler installed on that queue.
 *
 * Remove the `startAnonymizationSweep` call from the composition, or stop
 * passing the consumer to `ctx.worker`, and this fails.
 */

const bull = vi.hoisted(() => ({
  queues: [] as Array<{ name: string; upsertJobScheduler: ReturnType<typeof vi.fn> }>,
  workers: [] as Array<{ name: string; processor: () => Promise<unknown> }>,
}));
vi.mock('bullmq', () => ({
  Queue: class {
    readonly upsertJobScheduler = vi.fn(async () => undefined);
    readonly add = vi.fn(async () => undefined);
    readonly close = vi.fn(async () => undefined);
    constructor(readonly name: string) {
      bull.queues.push(this);
    }
  },
  Worker: class {
    constructor(
      readonly name: string,
      readonly processor: () => Promise<unknown>,
    ) {
      bull.workers.push(this);
    }
  },
}));

/** A registration: `ctx.asFunction(...).singleton().disposer(...)`, kept and never built. */
function registration(): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  for (const option of ['singleton', 'scoped', 'transient', 'disposer']) self[option] = () => self;
  return self;
}

async function composeAndMountRoutes(host: { processRunsWorkers: boolean; moduleQueueRedis: unknown }) {
  bull.queues.length = 0;
  bull.workers.length = 0;
  const routes: Array<(app: unknown) => Promise<void>> = [];
  const attached: unknown[] = [];
  const sweep = vi.fn(async () => 0);
  const cradle = {
    ...host,
    customers: {
      plugin: async () => undefined,
      handle: () => ({
        anonymizationSweepWorker: { sweep },
        addressBookRetirement: { hasWork: async () => false, runInScope: vi.fn() },
      }),
    },
  };
  const noop = (): void => undefined;
  const ctx = {
    asFunction: registration,
    asValue: registration,
    di: { providePort: noop, register: noop },
    subscribe: noop,
    onBoot: noop,
    routes: (mount: (app: unknown) => Promise<void>) => {
      routes.push(mount);
    },
    worker: (worker: unknown) => {
      attached.push(worker);
    },
    cradle: () => cradle,
    log: { info: noop, warn: noop, error: noop, debug: noop },
  } as unknown as ModuleContext;

  registerModule(ctx);
  const app = { log: {}, addHook: noop };
  for (const mount of routes) await mount(app);
  return { attached, sweep };
}

describe('customers — the anonymization sweep is scheduled by the module’s own composition (#677)', () => {
  it('in a process that consumes queues: a consumer of the sweep queue reaches ctx.worker, and the scheduler is installed', async () => {
    const { attached, sweep } = await composeAndMountRoutes({ processRunsWorkers: true, moduleQueueRedis: {} });

    const consumer = bull.workers.find((worker) => worker.name === ANONYMIZATION_SWEEP_QUEUE);
    expect(consumer, 'a consumer of the sweep queue').toBeDefined();
    expect(attached).toContain(consumer);
    const queue = bull.queues.find((candidate) => candidate.name === ANONYMIZATION_SWEEP_QUEUE);
    expect(queue?.upsertJobScheduler).toHaveBeenCalledWith(
      ANONYMIZATION_SWEEP_SCHEDULER_ID,
      { every: ANONYMIZATION_SWEEP_EVERY_MS },
      { name: 'sweep', data: {} },
    );

    // And what the consumer runs is the composed module's own sweep worker.
    await consumer?.processor();
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('in a process that consumes none: no consumer and no scheduler', async () => {
    const { attached } = await composeAndMountRoutes({ processRunsWorkers: false, moduleQueueRedis: undefined });
    expect(attached).toEqual([]);
    expect(bull.workers).toEqual([]);
    expect(bull.queues).toEqual([]);
  });
});
