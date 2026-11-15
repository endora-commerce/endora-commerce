import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { registerModule } from './index.js';
import { GTM_RELAY_QUEUE_NAME } from './services/ss-relay-queue.js';
import {
  GTM_RELAY_SWEEP_EVERY_MS,
  GTM_RELAY_SWEEP_QUEUE,
  GTM_RELAY_SWEEP_SCHEDULER_ID,
} from './services/ss-relay-sweep.js';

/**
 * The finished-job sweep of `google_tag_manager.ss.relay` has a clock (issue
 * #1248). This file composes the module **as `registerModule` composes it**,
 * against a recording context, and holds the facts that make a schedule: a
 * consumer of the sweep queue handed to the platform's worker seam
 * (`ctx.worker`, which is what stops it while the module is off), the Job
 * Scheduler installed on that queue, and a tick that cleans the relay queue the
 * module's own producer writes to. Where the module runs no relay consumer, it
 * runs no sweep either.
 */

const bull = vi.hoisted(() => ({
  queues: [] as Array<{
    name: string;
    upsertJobScheduler: ReturnType<typeof vi.fn>;
    clean: ReturnType<typeof vi.fn>;
  }>,
  workers: [] as Array<{ name: string; processor: () => Promise<unknown> }>,
}));
vi.mock('bullmq', () => ({
  Queue: class {
    readonly upsertJobScheduler = vi.fn(async () => undefined);
    readonly clean = vi.fn(async () => []);
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

// The route surface is not what this file holds.
vi.mock('./routes.storefront.js', () => ({ registerGoogleTagManagerStorefrontRoutes: async () => undefined }));

const originalRole = process.env['BACKEND_ROLE'];
afterEach(() => {
  if (originalRole === undefined) delete process.env['BACKEND_ROLE'];
  else process.env['BACKEND_ROLE'] = originalRole;
});

async function composeAndMountRoutes(host: { role: string | undefined; moduleQueueRedis: unknown }) {
  bull.queues.length = 0;
  bull.workers.length = 0;
  if (host.role === undefined) delete process.env['BACKEND_ROLE'];
  else process.env['BACKEND_ROLE'] = host.role;

  const routes: Array<(app: unknown) => Promise<void>> = [];
  const attached: unknown[] = [];
  const registered: Record<string, { build: (cradle: unknown) => unknown }> = {};
  const noop = (): void => undefined;
  const log = { info: noop, warn: noop, error: noop, debug: noop };
  const cradle: Record<string, unknown> = {
    settingsReadPort: { get: async () => undefined },
    moduleQueueRedis: host.moduleQueueRedis,
  };
  const ctx = {
    module: { id: 'google_tag_manager' },
    asFunction: (build: (cradle: unknown) => unknown) => {
      const self: Record<string, unknown> = { build };
      for (const option of ['singleton', 'scoped', 'transient', 'disposer']) self[option] = () => self;
      return self;
    },
    di: {
      providePort: noop,
      register: (entries: Record<string, { build: (cradle: unknown) => unknown }>) => {
        Object.assign(registered, entries);
      },
    },
    subscribe: noop,
    onBoot: noop,
    routes: (mount: (app: unknown) => Promise<void>) => {
      routes.push(mount);
    },
    worker: (worker: unknown) => {
      attached.push(worker);
    },
    cradle: () => cradle,
    log,
  } as unknown as ModuleContext;

  registerModule(ctx);
  // The singleton, built once, as the container would on first resolution.
  for (const [name, entry] of Object.entries(registered)) cradle[name] = entry.build(cradle);
  const app = { log, addHook: noop };
  for (const mount of routes) await mount(app);
  return { attached };
}

describe('google_tag_manager — the relay sweep is scheduled by the module’s own composition (#1248)', () => {
  it('where the relay consumer runs: a sweep consumer reaches ctx.worker and the scheduler is installed', async () => {
    const { attached } = await composeAndMountRoutes({ role: 'worker', moduleQueueRedis: {} });

    expect(bull.workers.map((worker) => worker.name)).toEqual([GTM_RELAY_QUEUE_NAME, GTM_RELAY_SWEEP_QUEUE]);
    expect(attached).toEqual(bull.workers);
    const sweepQueue = bull.queues.find((queue) => queue.name === GTM_RELAY_SWEEP_QUEUE);
    expect(sweepQueue?.upsertJobScheduler).toHaveBeenCalledWith(
      GTM_RELAY_SWEEP_SCHEDULER_ID,
      { every: GTM_RELAY_SWEEP_EVERY_MS },
      { name: 'sweep', data: {} },
    );

    // And what a tick cleans is the relay queue the module's producer writes to.
    await bull.workers[1]?.processor();
    const relayQueue = bull.queues.find((queue) => queue.name === GTM_RELAY_QUEUE_NAME);
    expect(relayQueue?.clean).toHaveBeenCalledTimes(2);
  });

  it('in an API-only process: no consumer and no scheduler', async () => {
    const { attached } = await composeAndMountRoutes({ role: 'api', moduleQueueRedis: {} });
    expect(attached).toEqual([]);
    expect(bull.queues.map((queue) => queue.name)).toEqual([GTM_RELAY_QUEUE_NAME]);
  });

  it('in a composition with no queue connection: nothing at all', async () => {
    const { attached } = await composeAndMountRoutes({ role: undefined, moduleQueueRedis: undefined });
    expect(attached).toEqual([]);
    expect(bull.queues).toEqual([]);
  });
});
