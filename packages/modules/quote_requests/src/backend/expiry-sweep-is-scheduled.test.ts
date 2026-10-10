import { describe, expect, it, vi } from 'vitest';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { registerModule } from './index.js';
import {
  RFQ_EXPIRY_SWEEP_EVERY_MS,
  RFQ_EXPIRY_SWEEP_QUEUE,
  RFQ_EXPIRY_SWEEP_SCHEDULER_ID,
} from './workers/rfq-expiry-sweep-worker.js';

/**
 * The expiry sweep has a caller.
 *
 * `RfqExpiryWorker.sweep()` existed, was exposed on the module's handle and was
 * documented as running every 30 minutes for as long as the module has had it —
 * and nothing called it. Every test drove `sweep()` by hand, so nothing could
 * notice. This file is what would have: it composes the module **as
 * `registerModule` composes it**, against a recording context, in a process
 * that says it consumes queues, and holds the two facts that make a schedule —
 * a consumer of the sweep's queue handed to the platform's worker seam, and
 * the Job Scheduler installed on that queue.
 *
 * Remove the `startRfqExpirySweep` call from the composition, or stop passing
 * the consumer to `ctx.worker`, and this fails.
 */

const bull = vi.hoisted(() => ({
  queues: [] as Array<{ name: string; upsertJobScheduler: ReturnType<typeof vi.fn> }>,
  workers: [] as Array<{ name: string; processor: () => Promise<unknown> }>,
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
  const hasExpirable = vi.fn(async () => false);
  const sweepInScope = vi.fn();
  const cradle = {
    ...host,
    quoteRequests: {
      register: async () => undefined,
      handle: () => ({ expiryWorker: { hasExpirable, sweepInScope } }),
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
  return { attached, hasExpirable, sweepInScope };
}

describe('quote_requests — the expiry sweep is scheduled by the module’s own composition', () => {
  it('in a process that consumes queues: a consumer of the sweep queue reaches ctx.worker, and the scheduler is installed', async () => {
    const { attached, hasExpirable } = await composeAndMountRoutes({ processRunsWorkers: true, moduleQueueRedis: {} });

    expect(bull.workers.map((worker) => worker.name)).toEqual([RFQ_EXPIRY_SWEEP_QUEUE]);
    expect(attached).toEqual([bull.workers[0]]);
    expect(bull.queues.map((queue) => queue.name)).toEqual([RFQ_EXPIRY_SWEEP_QUEUE]);
    expect(bull.queues[0]?.upsertJobScheduler).toHaveBeenCalledWith(
      RFQ_EXPIRY_SWEEP_SCHEDULER_ID,
      { every: RFQ_EXPIRY_SWEEP_EVERY_MS },
      { name: 'sweep', data: {} },
    );

    // And what the consumer runs is the composed module's own expiry worker.
    await bull.workers[0]?.processor();
    expect(hasExpirable).toHaveBeenCalledTimes(1);
  });

  it('in a process that consumes none: no consumer and no scheduler', async () => {
    const { attached } = await composeAndMountRoutes({ processRunsWorkers: false, moduleQueueRedis: undefined });
    expect(attached).toEqual([]);
    expect(bull.workers).toEqual([]);
    expect(bull.queues).toEqual([]);
  });
});
