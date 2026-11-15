import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { bridgeEventHandler } from './event-bridge.js';
import { WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS, WebhookDeliveryRetentionService } from './delivery-retention.js';
import { WEBHOOK_QUEUE_NAME, createWebhookQueue, webhookJobRetention, type WebhookJobData } from './webhook-queue.js';

/**
 * Issue #1003 — a `webhook.deliver` job carries the event's payload and the
 * receiver's signing secret. #928 gave the `webhook_deliveries` rows a
 * retention window; this file holds that BullMQ's own copy of a finished job
 * is bounded by the same window, by age and not only by count:
 *
 * - the queue's default job options carry an age bound, so no job is added
 *   without one;
 * - every job the bridge enqueues carries the window read when it is enqueued,
 *   so a changed setting applies to the next job;
 * - the daily retention tick removes finished jobs past the window, because
 *   BullMQ applies `age` only when another job finishes, and a quiet queue
 *   would otherwise keep its last failures indefinitely.
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

const DAY_SECONDS = 24 * 60 * 60;

beforeEach(() => {
  bull.queues.length = 0;
});

describe('webhooks — the job retention options (#1003)', () => {
  it('bounds finished jobs by the window’s age, keeping the count bounds', () => {
    expect(webhookJobRetention(30)).toEqual({
      removeOnComplete: { age: 30 * DAY_SECONDS, count: 500 },
      removeOnFail: { age: 30 * DAY_SECONDS, count: 5_000 },
    });
  });

  it('the queue’s default job options carry the default window as an age bound', () => {
    createWebhookQueue({} as never);
    const queue = bull.queues.find((candidate) => candidate.name === WEBHOOK_QUEUE_NAME);
    const defaults = queue?.options.defaultJobOptions;
    expect(defaults?.['removeOnFail']).toEqual({
      age: WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS * DAY_SECONDS,
      count: 5_000,
    });
    expect(defaults?.['removeOnComplete']).toEqual({
      age: WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS * DAY_SECONDS,
      count: 500,
    });
  });
});

describe('webhooks — an enqueued delivery carries the window read at enqueue time (#1003)', () => {
  const subscriptionLookup = {
    findActiveByEventType: async () => [
      { webhookId: 'wh-1', url: 'https://a.example.com/hook', secret: 's1' },
      { webhookId: 'wh-2', url: 'https://b.example.com/hook', secret: 's2' },
    ],
  };

  it('passes the current window as the job’s age bound, read once per event', async () => {
    const add = vi.fn(async (_name: string, _data: WebhookJobData, _opts?: unknown) => undefined);
    const retentionDays = vi.fn(async () => 30);
    await bridgeEventHandler('order.created.v1', { queue: { add } as never, subscriptionLookup, retentionDays })({
      eventId: 'evt-1',
    });

    expect(add).toHaveBeenCalledTimes(2);
    for (const call of add.mock.calls) expect(call[2]).toEqual(webhookJobRetention(30));
    expect(retentionDays).toHaveBeenCalledTimes(1);
  });

  it('a changed window applies to the next enqueued job', async () => {
    const add = vi.fn(async (_name: string, _data: WebhookJobData, _opts?: unknown) => undefined);
    let days = 30;
    const handler = bridgeEventHandler('order.created.v1', {
      queue: { add } as never,
      subscriptionLookup,
      retentionDays: async () => days,
    });
    await handler({ eventId: 'evt-1' });
    days = 7;
    await handler({ eventId: 'evt-2' });
    expect(add.mock.calls.at(-1)?.[2]).toEqual(webhookJobRetention(7));
  });

  it('reads no window when no subscription receives the event', async () => {
    const add = vi.fn(async () => undefined);
    const retentionDays = vi.fn(async () => 30);
    await bridgeEventHandler('order.created.v1', {
      queue: { add } as never,
      subscriptionLookup: { findActiveByEventType: async () => [] },
      retentionDays,
    })({ eventId: 'evt-1' });
    expect(add).not.toHaveBeenCalled();
    expect(retentionDays).not.toHaveBeenCalled();
  });
});

describe('webhooks — the retention tick removes finished jobs past the window (#1003)', () => {
  it('cleans the failed and the completed jobs older than the window, and says how many', async () => {
    const em = { nativeDelete: vi.fn(async () => 2) } as unknown as EntityManager;
    const clean = vi.fn(async (_grace: number, _limit: number, type?: string) =>
      type === 'failed' ? ['j1', 'j2', 'j3'] : ['j4'],
    );
    const service = new WebhookDeliveryRetentionService(
      () => em,
      async () => 30,
      () => ({ clean }),
    );

    const result = await service.purge(new Date('2026-11-15T12:00:00.000Z'));

    expect(result).toEqual({ retentionDays: 30, deleted: 2, jobsRemoved: 4 });
    expect(clean).toHaveBeenCalledWith(30 * DAY_SECONDS * 1000, 0, 'failed');
    expect(clean).toHaveBeenCalledWith(30 * DAY_SECONDS * 1000, 0, 'completed');
    expect(clean).toHaveBeenCalledTimes(2);
  });
});
