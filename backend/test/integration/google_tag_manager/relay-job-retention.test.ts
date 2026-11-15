import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
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
  GTM_RELAY_QUEUE_NAME,
  createGtmRelayQueue,
  type GtmRelayJobData,
} from '../../../../packages/modules/google_tag_manager/src/backend/services/ss-relay-queue.js';
import {
  GTM_RELAY_SWEEP_EVERY_MS,
  GTM_RELAY_SWEEP_QUEUE,
  GTM_RELAY_SWEEP_SCHEDULER_ID,
  startGtmRelaySweep,
  sweepFinishedGtmRelayJobs,
} from '../../../../packages/modules/google_tag_manager/src/backend/services/ss-relay-sweep.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Issue #1248 — a finished `google_tag_manager.ss.relay` job keeps the
 * visitor's `clientId`, the event's `params`, the page context and, with
 * consent, the IP address and user agent in Redis, so it is bounded by age: an hour once completed, three days once failed. Held on a real Redis
 * under a prefix of its own, because both halves are BullMQ's semantics, not
 * this module's code:
 *
 * - the age the queue's default job options carry is applied when a job
 *   **finishes**, to the jobs of the same set that finished before the bound;
 * - the hourly sweep removes what is past the bound with no job finishing at
 *   all — the quiet-queue case the age bound alone cannot cover.
 *
 * The second block runs the sweep on its own schedule, attached through the
 * platform's worker seam (`defineModuleWorker`, what `ctx.worker` applies), on
 * a booted platform so the module's presence is real: no tick runs while
 * `google_tag_manager` is deactivated, and the tick that waited runs once it is
 * back. That the module's composition makes this same call is held by
 * `packages/modules/google_tag_manager/src/backend/relay-sweep-is-scheduled.test.ts`.
 *
 * A job's age is its score in the finished set, so a job is aged by moving its
 * score back.
 */
describe('google_tag_manager — finished relay jobs leave Redis by age (issue #1248)', () => {
  const prefix = `gtm-relay-retention-test-${randomUUID().slice(0, 8)}`;
  let redis: Redis;
  let queue: Queue<GtmRelayJobData>;
  let worker: Worker<GtmRelayJobData>;
  const finished = new Set<string>();

  function data(eventId: string): GtmRelayJobData {
    return {
      eventId,
      salesChannelId: '11111111-1111-4111-8111-111111111111',
      clientId: '1234567890.1754006400',
      event: { name: 'purchase', params: { transaction_id: 'ORD-1', value: 10 } },
      consent: { analyticsStorage: 'granted' },
      page: { location: 'https://shop.example.com/checkout/thank-you', title: 'Thank you' },
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      occurredAt: new Date().toISOString(),
    };
  }

  /** Adds one job that completes, or fails on its only attempt, and waits for it to finish. */
  async function finishedJob(outcome: 'completed' | 'failed'): Promise<string> {
    const eventId = `${outcome}-${randomUUID()}`;
    const job = await queue.add(outcome, data(eventId), { jobId: eventId, attempts: 1 });
    const id = job.id ?? '';
    const deadline = Date.now() + 30_000;
    while (!finished.has(id) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(finished.has(id), `job ${id} ${outcome}`).toBe(true);
    return id;
  }

  async function age(state: 'completed' | 'failed', id: string, ms: number): Promise<void> {
    await redis.zadd(`${prefix}:${GTM_RELAY_QUEUE_NAME}:${state}`, Date.now() - ms, id);
  }

  async function isKept(id: string): Promise<boolean> {
    return (await queue.getJob(id)) !== undefined;
  }

  beforeAll(async () => {
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
    queue = createGtmRelayQueue(redis, { prefix });
    worker = new Worker<GtmRelayJobData>(
      GTM_RELAY_QUEUE_NAME,
      async (job) => {
        if (job.name === 'failed') throw new Error('destination answered 500');
      },
      { connection: redis, prefix },
    );
    worker.on('completed', (job) => finished.add(job.id ?? ''));
    worker.on('failed', (job) => {
      if (job?.id !== undefined) finished.add(job.id);
    });
    await worker.waitUntilReady();
  }, 60_000);

  afterAll(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    redis?.disconnect();
  });

  it('a job that fails removes the failed jobs older than three days', async () => {
    const old = await finishedJob('failed');
    await age('failed', old, 4 * DAY_MS);
    const recent = await finishedJob('failed');
    await age('failed', recent, 2 * DAY_MS);

    await finishedJob('failed');

    expect(await isKept(old)).toBe(false);
    expect(await isKept(recent)).toBe(true);
  }, 60_000);

  it('a job that completes removes the completed jobs older than an hour', async () => {
    const old = await finishedJob('completed');
    await age('completed', old, 2 * HOUR_MS);
    const recent = await finishedJob('completed');
    await age('completed', recent, 30 * 60 * 1000);

    await finishedJob('completed');

    expect(await isKept(old)).toBe(false);
    expect(await isKept(recent)).toBe(true);
  }, 60_000);

  it('the sweep removes finished jobs past their bound with no job finishing', async () => {
    const oldFailed = await finishedJob('failed');
    const recentFailed = await finishedJob('failed');
    const oldCompleted = await finishedJob('completed');
    const recentCompleted = await finishedJob('completed');
    await age('failed', oldFailed, 3 * DAY_MS + HOUR_MS);
    await age('failed', recentFailed, 3 * DAY_MS - HOUR_MS);
    await age('completed', oldCompleted, 2 * HOUR_MS);
    await age('completed', recentCompleted, 30 * 60 * 1000);

    expect(await sweepFinishedGtmRelayJobs(queue)).toBeGreaterThanOrEqual(2);

    expect(await isKept(oldFailed)).toBe(false);
    expect(await isKept(oldCompleted)).toBe(false);
    expect(await isKept(recentFailed)).toBe(true);
    expect(await isKept(recentCompleted)).toBe(true);
  }, 60_000);
});

describe('google_tag_manager — the composed sweep runs on its own clock and stops with the module (issue #1248)', () => {
  const prefix = `gtm-relay-sweep-test-${randomUUID().slice(0, 8)}`;
  let h: BackendServerHandle;
  let redis: Redis;
  let relayQueue: Queue<GtmRelayJobData>;
  let relayWorker: Worker<GtmRelayJobData>;
  let sweepQueue: Queue;
  let sweepWorker: Worker | undefined;
  const closers: Array<() => Promise<void>> = [];
  const failed = new Set<string>();
  const ticks: string[] = [];
  const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;

  const until = async (condition: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return condition();
  };

  /** A failed relay job aged past the three-day bound, with no job finishing after it. */
  async function expiredFailedJob(): Promise<string> {
    const eventId = `expired-${randomUUID()}`;
    await relayQueue.add('failed', dataOf(eventId), { jobId: eventId, attempts: 1 });
    expect(await until(() => failed.has(eventId), 30_000), `job ${eventId} failed`).toBe(true);
    await redis.zadd(`${prefix}:${GTM_RELAY_QUEUE_NAME}:failed`, Date.now() - 4 * DAY_MS, eventId);
    return eventId;
  }

  function dataOf(eventId: string): GtmRelayJobData {
    return {
      eventId,
      salesChannelId: '11111111-1111-4111-8111-111111111111',
      clientId: '1234567890.1754006400',
      event: { name: 'purchase', params: { transaction_id: 'ORD-1', value: 10 } },
      consent: { analyticsStorage: 'granted' },
      page: { location: 'https://shop.example.com/checkout/thank-you', title: 'Thank you' },
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
      occurredAt: new Date().toISOString(),
    };
  }

  const isKept = async (id: string): Promise<boolean> => (await relayQueue.getJob(id)) !== undefined;

  beforeAll(async () => {
    h = await setupBackendServer();
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
    relayQueue = createGtmRelayQueue(redis, { prefix });
    relayWorker = new Worker<GtmRelayJobData>(
      GTM_RELAY_QUEUE_NAME,
      async () => {
        throw new Error('destination answered 500');
      },
      { connection: redis, prefix },
    );
    relayWorker.on('failed', (job) => {
      if (job?.id !== undefined) failed.add(job.id);
    });
    await relayWorker.waitUntilReady();
    sweepQueue = new Queue(GTM_RELAY_SWEEP_QUEUE, { connection: redis, prefix });
  }, 120_000);

  afterAll(async () => {
    for (const close of closers) await close();
    await sweepWorker?.close();
    await relayWorker?.close();
    await sweepQueue?.obliterate({ force: true }).catch(() => undefined);
    await sweepQueue?.close();
    await relayQueue?.obliterate({ force: true }).catch(() => undefined);
    await relayQueue?.close();
    redis?.disconnect();
    if (h) await teardownBackendServer(h);
  });

  it('installs one hourly scheduler, and its first tick removes an expired job no other job would have', async () => {
    const expired = await expiredFailedJob();

    await startGtmRelaySweep({
      redis,
      relayQueue,
      log,
      queuePrefix: prefix,
      attach: (built) => {
        sweepWorker = defineModuleWorker('google_tag_manager', built);
        built.on('completed', (job) => {
          ticks.push(job.id ?? '');
        });
      },
      onClose: (close) => closers.push(close),
    });

    const schedulers = await sweepQueue.getJobSchedulers();
    expect(schedulers.map((scheduler) => scheduler.key)).toEqual([GTM_RELAY_SWEEP_SCHEDULER_ID]);
    expect(Number(schedulers[0]!.every)).toBe(GTM_RELAY_SWEEP_EVERY_MS);
    expect(await until(async () => !(await isKept(expired)), 30_000), 'the scheduled tick removed the job').toBe(true);
  }, 120_000);

  it('while google_tag_manager is deactivated no tick runs, and the waiting tick runs once it is back', async () => {
    expect(sweepWorker, 'the earlier case started the consumer').toBeDefined();
    const expired = await expiredFailedJob();
    let tick: { id?: string | undefined } = {};
    await withModuleOff('google_tag_manager', 'deactivated', async () => {
      tick = await sweepQueue.add('sweep', {});
      // Long enough for a running consumer to have taken it many times over.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(ticks).not.toContain(tick.id);
      expect(await isKept(expired)).toBe(true);
    });
    expect(await until(() => ticks.includes(tick.id ?? ''), 60_000)).toBe(true);
    expect(await isKept(expired)).toBe(false);
  }, 120_000);
});
