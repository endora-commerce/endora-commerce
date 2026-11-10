import { describe, expect, it, vi } from 'vitest';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { registerModule } from './index.js';
import {
  WEBHOOK_DELIVERY_RETENTION_EVERY_MS,
  WEBHOOK_DELIVERY_RETENTION_QUEUE,
  WEBHOOK_DELIVERY_RETENTION_SCHEDULER_ID,
  runWebhookDeliveryRetentionTick,
} from './services/delivery-retention-worker.js';
import {
  WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS,
  deliveryRetentionCutoff,
  retentionDaysFrom,
} from './services/delivery-retention.js';

/**
 * Issue #928 — `webhook_deliveries` keeps each event's payload verbatim, so it
 * gets a retention window: a daily tick deletes the finished rows past
 * `webhooks.delivery_retention_days`.
 *
 * This file holds three facts without a database: what a stored value means,
 * what one tick does, and that the module's **own composition** schedules the
 * tick — composed as `registerModule` composes it, against a recording context,
 * the way `customers`' `anonymization-sweep-is-scheduled.test.ts` holds its
 * sweep. Remove the `startWebhookDeliveryRetention` call, or stop handing its
 * consumer to `ctx.worker`, and this fails. The rows it deletes, and that it
 * deletes nothing while the module is off, are
 * `backend/test/integration/webhooks/delivery-retention*.test.ts`.
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
// The admin routes are not what this file is about.
vi.mock('./routes.js', () => ({ registerWebhooksAdminRoutes: async () => undefined }));

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function registration(): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  for (const option of ['singleton', 'scoped', 'transient', 'disposer']) self[option] = () => self;
  return self;
}

async function composeAndMountRoutes(host: { webhooksRunWorkers: boolean }) {
  bull.queues.length = 0;
  bull.workers.length = 0;
  const routes: Array<(app: unknown) => Promise<void>> = [];
  const attached: unknown[] = [];
  const purge = vi.fn(async () => ({ retentionDays: 365, deleted: 0 }));
  const cradle = {
    ...host,
    redis: {},
    requireAdmin: () => undefined,
    webhookDeliveryWorker: { name: 'webhook.deliver' },
    webhookDeliveryRetention: { purge },
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
    log: silent,
  } as unknown as ModuleContext;

  registerModule(ctx);
  const app = { log: {}, addHook: noop };
  for (const mount of routes) await mount(app);
  return { attached, purge };
}

describe('webhooks — what a stored retention value means (#928)', () => {
  it.each([
    [30, 30],
    [1, 1],
    [3650, 3650],
    [0, WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS],
    [-5, WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS],
    [3651, WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS],
    [12.5, WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS],
    ['30', WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS],
    [null, WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS],
  ])('%j is read as %d days', (stored, expected) => {
    expect(retentionDaysFrom(stored)).toBe(expected);
  });

  it('defaults to a year', () => {
    expect(WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS).toBe(365);
  });

  it('the cutoff is the window before now', () => {
    const now = new Date('2026-11-09T12:00:00.000Z');
    expect(deliveryRetentionCutoff(30, now).toISOString()).toBe('2026-10-10T12:00:00.000Z');
  });
});

describe('webhooks — one retention tick (#928)', () => {
  it('runs one purge and says what it deleted', async () => {
    const log = { ...silent, info: vi.fn() };
    const purge = vi.fn(async () => ({ retentionDays: 30, deleted: 4 }));
    await runWebhookDeliveryRetentionTick({ retention: { purge }, log: log as never });
    expect(purge).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith({ retentionDays: 30, deleted: 4 }, expect.any(String));
  });

  it('a failed purge is re-thrown, so the job is recorded as failed', async () => {
    const boom = new Error('connection reset');
    await expect(
      runWebhookDeliveryRetentionTick({ retention: { purge: async () => Promise.reject(boom) }, log: silent as never }),
    ).rejects.toBe(boom);
  });

  it('a module switched off underneath the tick is re-thrown as it is', async () => {
    const disabled = new ModuleDisabledError('webhooks');
    await expect(
      runWebhookDeliveryRetentionTick({
        retention: { purge: async () => Promise.reject(disabled) },
        log: silent as never,
      }),
    ).rejects.toBe(disabled);
  });
});

describe('webhooks — the retention tick is scheduled by the module’s own composition (#928)', () => {
  it('where the module runs workers: a consumer of the retention queue reaches ctx.worker, and the scheduler is installed', async () => {
    const { attached, purge } = await composeAndMountRoutes({ webhooksRunWorkers: true });

    const consumer = bull.workers.find((worker) => worker.name === WEBHOOK_DELIVERY_RETENTION_QUEUE);
    expect(consumer, 'a consumer of the retention queue').toBeDefined();
    expect(attached).toContain(consumer);
    const queue = bull.queues.find((candidate) => candidate.name === WEBHOOK_DELIVERY_RETENTION_QUEUE);
    expect(queue?.upsertJobScheduler).toHaveBeenCalledWith(
      WEBHOOK_DELIVERY_RETENTION_SCHEDULER_ID,
      { every: WEBHOOK_DELIVERY_RETENTION_EVERY_MS },
      { name: 'purge', data: {} },
    );

    // What the consumer runs is the composed module's own retention service.
    await consumer?.processor();
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it('where it runs none: no retention consumer and no scheduler', async () => {
    const { attached } = await composeAndMountRoutes({ webhooksRunWorkers: false });
    expect(attached).toEqual([]);
    expect(bull.workers).toEqual([]);
    expect(bull.queues).toEqual([]);
  });
});
