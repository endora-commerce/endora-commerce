import { randomUUID } from 'node:crypto';
import { Worker, type Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Webhook } from '../../helpers/package-entities.js';
import { storeWebhookSubscription } from '../../helpers/webhook-deliveries.js';
import {
  WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS,
  WEBHOOK_DELIVERY_RETENTION_SETTING,
  WebhookDeliveryRetentionService,
} from '../../../../packages/modules/webhooks/src/backend/services/delivery-retention.js';
import {
  WEBHOOK_QUEUE_NAME,
  createWebhookQueue,
  webhookJobRetention,
  type WebhookJobData,
} from '../../../../packages/modules/webhooks/src/backend/services/webhook-queue.js';

const DAY_MS = 86_400_000;

/**
 * Issue #1003 — a finished `webhook.deliver` job keeps the event's payload and
 * the signing secret in Redis, so it is bounded by the delivery-history
 * retention window, by age. Held on a real Redis under a prefix of its own,
 * because both halves are BullMQ's semantics, not this module's code:
 *
 * - the age a job carries is applied when a job **finishes**, to the jobs that
 *   finished before the window;
 * - the retention tick's `purge()` removes what is past the window with no job
 *   finishing at all — the quiet-queue case the age bound alone cannot cover.
 *
 * A job's age is its score in the finished set, so a job is aged by moving its
 * score back.
 */
describe('webhooks — the composed module bounds its delivery jobs by the retention window (issue #1003)', () => {
  let h: BackendServerHandle;
  let webhookId: string | undefined;

  interface Cradle {
    webhookQueue: Queue<WebhookJobData>;
    settingsReadPort: SettingsReadPort;
    webhookDeliveryRetention: WebhookDeliveryRetentionService;
  }
  const cradle = (): Cradle => h.container.cradle as unknown as Cradle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 120_000);

  afterAll(async () => {
    if (h && webhookId) {
      await h.em().fork().nativeDelete(Webhook, { id: webhookId });
    }
    await teardownBackendServer(h);
  });

  it('a bridged event enqueues its job with the window read at enqueue time as the age bound', async () => {
    webhookId = await storeWebhookSubscription(h, ['order.created.v1']);
    const queue = cradle().webhookQueue;
    const settings = cradle().settingsReadPort;
    const originalAdd = queue.add;
    const originalGet = settings.get;
    const options: unknown[] = [];
    let stored: unknown = 30;
    queue.add = (async (_name: string, _data: WebhookJobData, opts?: unknown) => {
      options.push(opts);
      return undefined;
    }) as never;
    settings.get = (async (code: string, ...rest: unknown[]) =>
      code === WEBHOOK_DELIVERY_RETENTION_SETTING
        ? stored
        : (originalGet as (...args: unknown[]) => Promise<unknown>).call(settings, code, ...rest)) as never;
    const emit = async (): Promise<void> => {
      h.eventBus.emit('order.created.v1', {
        eventId: randomUUID(),
        organizationId: null,
        orderId: randomUUID(),
      } as unknown as Parameters<typeof h.eventBus.emit>[1]);
      const deadline = Date.now() + 5_000;
      const before = options.length;
      while (options.length === before && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    try {
      await emit();
      expect(options.at(-1)).toEqual(webhookJobRetention(30));
      stored = 7;
      await emit();
      expect(options.at(-1)).toEqual(webhookJobRetention(7));
    } finally {
      queue.add = originalAdd;
      settings.get = originalGet;
    }
  }, 60_000);

  it('the composed retention tick cleans the composed queue’s finished jobs past the window', async () => {
    const queue = cradle().webhookQueue;
    const original = queue.clean;
    const calls: unknown[][] = [];
    queue.clean = (async (...args: unknown[]) => {
      calls.push(args);
      return [];
    }) as never;
    try {
      const result = await cradle().webhookDeliveryRetention.purge();
      expect(result.jobsRemoved).toBe(0);
    } finally {
      queue.clean = original;
    }
    const graceMs = WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS * DAY_MS;
    expect(calls).toEqual([
      [graceMs, 0, 'failed'],
      [graceMs, 0, 'completed'],
    ]);
  }, 60_000);
});

describe('webhooks — finished delivery jobs past the retention window leave Redis (issue #1003)', () => {
  const prefix = `webhooks-job-retention-test-${randomUUID().slice(0, 8)}`;
  let redis: Redis;
  let queue: Queue<WebhookJobData>;
  let worker: Worker<WebhookJobData>;
  const failed = new Set<string>();

  function data(eventId: string): WebhookJobData {
    return {
      webhookId: 'wh-1',
      eventId,
      eventType: 'organization.blocked.v1',
      payload: { organizationId: 'org-1', reason: 'Jan Kowalski forged his registration documents' },
      url: 'https://example.invalid/hook',
      secret: 'shhh',
    };
  }

  /** Adds one job that fails on its only attempt, and waits for it to be failed. */
  async function failedJob(eventId: string, retentionDays: number): Promise<string> {
    const job = await queue.add(eventId, data(eventId), { ...webhookJobRetention(retentionDays), attempts: 1 });
    const id = job.id ?? '';
    const deadline = Date.now() + 30_000;
    while (!failed.has(id) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(failed.has(id), `job ${id} failed`).toBe(true);
    return id;
  }

  async function ageFailed(id: string, days: number): Promise<void> {
    await redis.zadd(`${prefix}:${WEBHOOK_QUEUE_NAME}:failed`, Date.now() - days * DAY_MS, id);
  }

  async function isKept(id: string): Promise<boolean> {
    return (await queue.getJob(id)) !== undefined;
  }

  beforeAll(async () => {
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
    queue = createWebhookQueue(redis, { prefix });
    worker = new Worker<WebhookJobData>(
      WEBHOOK_QUEUE_NAME,
      async () => {
        throw new Error('receiver answered 500');
      },
      { connection: redis, prefix },
    );
    worker.on('failed', (job) => {
      if (job?.id !== undefined) failed.add(job.id);
    });
  }, 60_000);

  afterAll(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    redis?.disconnect();
  });

  it('a job that fails removes the failed jobs older than the window it carries', async () => {
    const old = await failedJob(`evt-old-${randomUUID()}`, 30);
    await ageFailed(old, 40);
    const recent = await failedJob(`evt-recent-${randomUUID()}`, 30);
    await ageFailed(recent, 10);

    await failedJob(`evt-trigger-${randomUUID()}`, 30);

    expect(await isKept(old)).toBe(false);
    expect(await isKept(recent)).toBe(true);
  }, 60_000);

  it('the retention purge removes a failed job past the window with no job finishing', async () => {
    const old = await failedJob(`evt-quiet-old-${randomUUID()}`, 365);
    await ageFailed(old, 31);
    const recent = await failedJob(`evt-quiet-recent-${randomUUID()}`, 365);
    await ageFailed(recent, 29);

    const em = { nativeDelete: async () => 0 } as unknown as EntityManager;
    const service = new WebhookDeliveryRetentionService(
      () => em,
      async () => 30,
      () => queue,
    );
    const result = await service.purge();

    expect(result.jobsRemoved).toBeGreaterThanOrEqual(1);
    expect(await isKept(old)).toBe(false);
    expect(await isKept(recent)).toBe(true);
  }, 60_000);
});
