import { describe, expect, it, vi } from 'vitest';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { registerModule } from './index.js';
import {
  CART_ABANDONMENT_SWEEP_EVERY_MS,
  CART_ABANDONMENT_SWEEP_QUEUE,
  CART_ABANDONMENT_SWEEP_SCHEDULER_ID,
} from './workers/cart-abandonment-sweep-worker.js';

/**
 * The abandonment sweep has a clock (issue #1119).
 *
 * Until this change `CartAbandonmentWorker.sweep()` ran only when an operator
 * scheduled `carts abandonment-sweep` by hand, so abandoned baskets were never
 * marked and orphaned working baskets (#602) never removed on an instance
 * whose operator had not written a cron entry. This file composes the module
 * **as `registerModule` composes it**, against a recording context, and holds
 * the two facts that make a schedule — a consumer of the sweep's queue handed
 * to the platform's worker seam (`ctx.worker`, which is what stops it while
 * `carts` is off), and the Job Scheduler installed on that queue.
 *
 * Remove the `startCartAbandonmentSweep` call from the composition, or stop
 * passing the consumer to `ctx.worker`, and this fails.
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

// The route surfaces are not what this file holds; they would need a Fastify.
vi.mock('./routes.js', () => ({ registerCartRoutes: async () => undefined }));
vi.mock('./routes.admin.js', () => ({ registerCartsAdminRoutes: async () => undefined }));
vi.mock('./routes.organization.js', () => ({ registerCartsOrganizationRoutes: async () => undefined }));

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
  const hasSweepWork = vi.fn(async () => false);
  const sweepInScope = vi.fn();
  const cradle = {
    ...host,
    emFactory: () => ({}),
    cartApprovalService: {},
    cartAuditService: {},
    cartRecomputeCache: {},
    requireAdmin: () => undefined,
    cartAbandonmentWorker: { hasSweepWork, sweepInScope },
  };
  const noop = (): void => undefined;
  const ctx = {
    module: { id: 'carts' },
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
  return { attached, hasSweepWork, sweepInScope };
}

describe('carts — the abandonment sweep is scheduled by the module’s own composition', () => {
  it('in a process that consumes queues: a consumer of the sweep queue reaches ctx.worker, and the scheduler is installed', async () => {
    const { attached, hasSweepWork } = await composeAndMountRoutes({ processRunsWorkers: true, moduleQueueRedis: {} });

    expect(bull.workers.map((worker) => worker.name)).toEqual([CART_ABANDONMENT_SWEEP_QUEUE]);
    expect(attached).toEqual([bull.workers[0]]);
    expect(bull.queues.map((queue) => queue.name)).toEqual([CART_ABANDONMENT_SWEEP_QUEUE]);
    expect(bull.queues[0]?.upsertJobScheduler).toHaveBeenCalledWith(
      CART_ABANDONMENT_SWEEP_SCHEDULER_ID,
      { every: CART_ABANDONMENT_SWEEP_EVERY_MS },
      { name: 'sweep', data: {} },
    );

    // And what the consumer runs is the composed module's own sweep.
    await bull.workers[0]?.processor();
    expect(hasSweepWork).toHaveBeenCalledTimes(1);
  });

  it('in a process that consumes none: no consumer and no scheduler', async () => {
    const { attached } = await composeAndMountRoutes({ processRunsWorkers: false, moduleQueueRedis: undefined });
    expect(attached).toEqual([]);
    expect(bull.workers).toEqual([]);
    expect(bull.queues).toEqual([]);
  });
});
