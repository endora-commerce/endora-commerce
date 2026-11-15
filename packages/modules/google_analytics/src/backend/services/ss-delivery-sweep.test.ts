import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GA_DELIVERY_KEEP_COMPLETED,
  GA_DELIVERY_KEEP_FAILED,
  GA_DELIVERY_QUEUE_NAME,
  createGaDeliveryQueue,
} from './ss-delivery-queue.js';
import {
  GA_DELIVERY_SWEEP_EVERY_MS,
  GA_DELIVERY_SWEEP_SCHEDULER_ID,
  ensureGaDeliverySweepSchedule,
  runGaDeliverySweepTick,
  sweepFinishedGaDeliveryJobs,
} from './ss-delivery-sweep.js';

/**
 * Issue #1248 — a `google_analytics.ss.deliver` job carries the visitor's
 * `clientId` and the event's `params`, and BullMQ keeps its own copy of every
 * finished job in Redis. Until this file the queue bounded those copies by
 * count only (500 completed, 5 000 failed), so on a quiet instance a finished
 * job stayed in Redis indefinitely. This file holds:
 *
 * - the queue's default job options bound finished jobs by age as well as by
 *   count — a completed job has nothing left to say, a failed one is kept long
 *   enough to be diagnosed;
 * - the hourly sweep removes the finished jobs past those bounds, because
 *   BullMQ applies `age` only when another job finishes in the same set.
 */

const bull = vi.hoisted(() => ({
  queues: [] as Array<{ name: string; options: { defaultJobOptions?: Record<string, unknown> } }>,
}));
vi.mock('bullmq', () => ({
  Queue: class {
    constructor(
      readonly name: string,
      readonly options: { defaultJobOptions?: Record<string, unknown> },
    ) {
      bull.queues.push(this);
    }
  },
  Worker: class {},
}));

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

beforeEach(() => {
  bull.queues.length = 0;
});

describe('google_analytics — finished delivery jobs are bounded by age (#1248)', () => {
  it('keeps a completed job for an hour and a failed one for three days, with the count bounds kept', () => {
    expect(GA_DELIVERY_KEEP_COMPLETED).toEqual({ age: HOUR_SECONDS, count: 500 });
    expect(GA_DELIVERY_KEEP_FAILED).toEqual({ age: 3 * DAY_SECONDS, count: 5_000 });
  });

  it('the queue’s default job options carry both bounds', () => {
    createGaDeliveryQueue({} as never);
    const queue = bull.queues.find((candidate) => candidate.name === GA_DELIVERY_QUEUE_NAME);
    expect(queue?.options.defaultJobOptions?.['removeOnComplete']).toEqual(GA_DELIVERY_KEEP_COMPLETED);
    expect(queue?.options.defaultJobOptions?.['removeOnFail']).toEqual(GA_DELIVERY_KEEP_FAILED);
  });
});

describe('google_analytics — the sweep removes finished jobs past the bounds (#1248)', () => {
  it('cleans the completed and the failed set by their own bound, unlimited, and says how many', async () => {
    const clean = vi.fn(async (_grace: number, _limit: number, type?: string) =>
      type === 'failed' ? ['j1', 'j2'] : ['j3'],
    );

    expect(await sweepFinishedGaDeliveryJobs({ clean })).toBe(3);
    expect(clean).toHaveBeenCalledWith(HOUR_SECONDS * 1000, 0, 'completed');
    expect(clean).toHaveBeenCalledWith(3 * DAY_SECONDS * 1000, 0, 'failed');
    expect(clean).toHaveBeenCalledTimes(2);
  });

  it('a tick that removed something says so', async () => {
    const log = { ...silent, info: vi.fn() };
    await runGaDeliverySweepTick({ deliveryQueue: { clean: async () => ['j1'] }, log: log as never });
    expect(log.info).toHaveBeenCalledWith({ jobsRemoved: 2 }, expect.any(String));
  });

  it('a failed clean is re-thrown, so the tick is recorded as failed', async () => {
    const log = { ...silent, warn: vi.fn() };
    await expect(
      runGaDeliverySweepTick({
        deliveryQueue: {
          clean: async () => {
            throw new Error('redis gone');
          },
        },
        log: log as never,
      }),
    ).rejects.toThrow('redis gone');
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('installs one hourly schedule under a stable id', async () => {
    const upsertJobScheduler = vi.fn(async () => undefined);
    await ensureGaDeliverySweepSchedule({ upsertJobScheduler } as never);
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      GA_DELIVERY_SWEEP_SCHEDULER_ID,
      { every: GA_DELIVERY_SWEEP_EVERY_MS },
      { name: 'sweep', data: {} },
    );
    expect(GA_DELIVERY_SWEEP_EVERY_MS).toBe(HOUR_SECONDS * 1000);
  });
});
