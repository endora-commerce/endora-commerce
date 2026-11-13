import { describe, expect, it, vi } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { RFQ_NOTIFICATION_DELIVERY_QUEUE } from '../services/notifications/kick.js';
import {
  ensureRfqNotificationDeliverySchedule,
  RFQ_NOTIFICATION_DELIVERY_EVERY_MS,
  RFQ_NOTIFICATION_DELIVERY_SCHEDULER_ID,
  RFQ_NOTIFICATION_DELIVERY_SCOPE_REASON,
  runRfqNotificationDeliveryTick,
  startRfqNotificationDelivery,
} from './rfq-notification-delivery-worker.js';

/**
 * `specs/179-rfq-and-customer-notifications/` FR-010, research R-8 (T044) —
 * the clock of the delivery: a Job Scheduler every minute, the kick's queue,
 * one tick at a time, a system scope only for a tick that has something to do.
 * BullMQ is stood in for; no connection is opened.
 */
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
const nothing = { claimed: 0, closed: 0, retried: 0, reachedBatchLimit: false };

function delivery(hasDeliverable: () => Promise<boolean>) {
  const scopes: Array<{ kind: string | undefined; reason: string | undefined }> = [];
  const probeScopes: Array<string | undefined> = [];
  const probe = vi.fn(async () => {
    probeScopes.push(getTenantContext()?.actor.kind);
    return hasDeliverable();
  });
  const pass = vi.fn(async () => {
    const context = getTenantContext() as { actor: { kind: string }; reason?: string } | undefined;
    scopes.push({ kind: context?.actor.kind, reason: context?.reason });
    return nothing;
  });
  return { value: { hasDeliverable: probe, deliverInScope: pass }, probe, pass, scopes, probeScopes };
}

describe('quote_requests notification delivery worker', () => {
  it('consumes the kick’s queue and ticks every minute', () => {
    expect(RFQ_NOTIFICATION_DELIVERY_QUEUE).toBe('quote_requests.notifications.deliver');
    expect(RFQ_NOTIFICATION_DELIVERY_SCHEDULER_ID).toBe('quote_requests.notifications.deliver');
    expect(RFQ_NOTIFICATION_DELIVERY_EVERY_MS).toBe(60_000);
  });

  it.each([
    ['the process runs none', { processRunsWorkers: false, moduleQueueRedis: {} as never }],
    ['the composition offers no connection', { processRunsWorkers: true, moduleQueueRedis: undefined }],
  ])('builds no consumer and installs no schedule where %s', async (_where, host) => {
    const attach = vi.fn();
    const onClose = vi.fn();
    const started = await startRfqNotificationDelivery({
      delivery: delivery(async () => false).value,
      log: logger(),
      attach,
      onClose,
      ...host,
    });
    expect(started).toBe(false);
    expect(attach).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('where the process consumes queues: one consumer through ctx.worker, one tick at a time, the schedule installed', async () => {
    bull.queues.length = 0;
    bull.workers.length = 0;
    const attach = vi.fn();
    const closers: Array<() => Promise<void>> = [];
    const d = delivery(async () => false);
    const started = await startRfqNotificationDelivery({
      delivery: d.value,
      log: logger(),
      processRunsWorkers: true,
      moduleQueueRedis: {} as never,
      attach,
      onClose: (close) => closers.push(close),
    });
    expect(started).toBe(true);
    expect(bull.queues.map((queue) => queue.name)).toEqual([RFQ_NOTIFICATION_DELIVERY_QUEUE]);
    expect(bull.workers.map((worker) => worker.name)).toEqual([RFQ_NOTIFICATION_DELIVERY_QUEUE]);
    expect(attach).toHaveBeenCalledWith(bull.workers[0]);
    expect(bull.workers[0]?.options).toMatchObject({ concurrency: 1 });
    expect(bull.queues[0]?.upsertJobScheduler).toHaveBeenCalledWith(
      RFQ_NOTIFICATION_DELIVERY_SCHEDULER_ID,
      { every: RFQ_NOTIFICATION_DELIVERY_EVERY_MS },
      { name: 'deliver', data: {} },
    );
    // What the consumer runs — a kick or a scheduled tick alike — is one tick.
    await bull.workers[0]?.processor();
    expect(d.probe).toHaveBeenCalledTimes(1);
    await closers[0]?.();
    expect(bull.queues[0]?.close).toHaveBeenCalledTimes(1);
  });

  it('the schedule is idempotent by its id and carries no data', async () => {
    const upsertJobScheduler = vi.fn(async () => undefined);
    await ensureRfqNotificationDeliverySchedule({ upsertJobScheduler } as never);
    expect(upsertJobScheduler.mock.calls).toEqual([
      ['quote_requests.notifications.deliver', { every: 60_000 }, { name: 'deliver', data: {} }],
    ]);
  });

  describe('one tick', () => {
    it('idle: the probe runs outside any scope, and no scope is entered', async () => {
      const d = delivery(async () => false);
      await runRfqNotificationDeliveryTick({ delivery: d.value, log: logger() });
      expect(d.probeScopes).toEqual([undefined]);
      expect(d.pass).not.toHaveBeenCalled();
    });

    it('busy: the system scope is entered once, for the pass', async () => {
      const d = delivery(async () => true);
      await runRfqNotificationDeliveryTick({ delivery: d.value, log: logger() });
      expect(d.probeScopes).toEqual([undefined]);
      expect(d.scopes).toEqual([{ kind: 'system', reason: RFQ_NOTIFICATION_DELIVERY_SCOPE_REASON }]);
    });

    it('a probe that cannot answer counts as yes', async () => {
      const d = delivery(async () => {
        throw new Error('the probe could not read');
      });
      await runRfqNotificationDeliveryTick({ delivery: d.value, log: logger() });
      expect(d.pass).toHaveBeenCalledTimes(1);
    });

    it('a failed pass is logged and does not fail the job — the next tick is the retry', async () => {
      const log = logger();
      await expect(
        runRfqNotificationDeliveryTick({
          delivery: {
            hasDeliverable: async () => true,
            deliverInScope: async () => {
              throw new Error('database went away');
            },
          },
          log,
        }),
      ).resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('quote_requests switched off under the pass is never swallowed', async () => {
      await expect(
        runRfqNotificationDeliveryTick({
          delivery: {
            hasDeliverable: async () => true,
            deliverInScope: async () => {
              throw new ModuleDisabledError('quote_requests');
            },
          },
          log: logger(),
        }),
      ).rejects.toBeInstanceOf(ModuleDisabledError);
    });
  });
});
