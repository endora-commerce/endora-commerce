import { randomUUID } from 'node:crypto';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { Webhook, WebhookDelivery } from '../../helpers/package-entities.js';
import { defineModuleWorker } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import type { WebhookDeliveryRetentionService } from '../../../../packages/modules/webhooks/src/backend/services/delivery-retention.js';
import {
  WEBHOOK_DELIVERY_RETENTION_QUEUE,
  startWebhookDeliveryRetention,
} from '../../../../packages/modules/webhooks/src/backend/services/delivery-retention-worker.js';

const DAY_MS = 86_400_000;

/**
 * Issue #928 — a finished webhook delivery past `webhooks.delivery_retention_days`
 * (365 by default) is deleted by the **scheduled job**, and by nothing else.
 *
 * Nothing here calls `purge()`: the module's own `startWebhookDeliveryRetention`
 * builds the consumer and installs the Job Scheduler on a real Redis, over the
 * retention service the composed module built — which reads the setting through
 * the platform's settings port — and attaches the consumer through the
 * platform's worker seam (`defineModuleWorker`, which is what `ctx.worker`
 * applies). The shared test server runs no consumer (`webhooksRunWorkers` is
 * false there), so this file is where the two halves meet; that the module's
 * composition makes this same call is held by
 * `packages/modules/webhooks/src/backend/delivery-retention-is-scheduled.test.ts`.
 *
 * Off is non-destructive (Principle XVII): while `webhooks` is off no tick runs
 * and the history stays; the first tick after it is back deletes what is due.
 */
describe('webhooks — the delivery history retention runs on its schedule (#928)', () => {
  let h: BackendServerHandle;
  let redis: Redis;
  let queue: Queue;
  let worker: Worker | undefined;
  let webhookId: string;
  const closers: Array<() => Promise<void>> = [];
  const completed: string[] = [];
  const prefix = `webhooks-retention-test-${randomUUID().slice(0, 8)}`;

  async function delivery(status: 'pending' | 'succeeded' | 'dead_lettered', daysAgo: number): Promise<string> {
    const em = h.em().fork();
    const row = em.create(WebhookDelivery, {
      webhookId,
      eventId: `evt-${randomUUID()}`,
      eventType: 'organization.blocked.v1',
      payload: { organizationId: randomUUID(), reason: 'Jan Kowalski forged his registration documents' },
      status,
      attemptCount: 1,
    });
    await em.persistAndFlush(row);
    await em.nativeUpdate(WebhookDelivery, { id: row.id }, { createdAt: new Date(Date.now() - daysAgo * DAY_MS) });
    return row.id;
  }

  const exists = async (id: string): Promise<boolean> =>
    (await h.em().fork().findOne(WebhookDelivery, { id })) !== null;

  const until = async (condition: () => Promise<boolean>, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return condition();
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em().fork();
    const webhook = em.create(Webhook, {
      name: 'Retention schedule probe',
      url: 'https://example.invalid/hook',
      secret: 'shhh',
      eventTypes: ['organization.blocked.v1'],
      status: 'active',
    });
    await em.persistAndFlush(webhook);
    webhookId = webhook.id;
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
    queue = new Queue(WEBHOOK_DELIVERY_RETENTION_QUEUE, { connection: redis, prefix });
  }, 120_000);

  afterAll(async () => {
    for (const close of closers) await close();
    await worker?.close();
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    redis?.disconnect();
    if (h && webhookId) {
      // Cascades onto this file's delivery rows.
      await h.em().getConnection().execute(`delete from "webhooks" where "id" = ?`, [webhookId]);
    }
    await teardownBackendServer(h);
  });

  it('one tick deletes a finished delivery past the default window and keeps a recent one and a pending one — nothing calls purge()', async () => {
    const due = await delivery('succeeded', 400);
    const recent = await delivery('dead_lettered', 10);
    const pending = await delivery('pending', 400);

    const started = await startWebhookDeliveryRetention({
      runWorkers: true,
      redis,
      queuePrefix: prefix,
      // The retention service the composed module built, reading the setting as production does.
      retention: (h.container.cradle as unknown as { webhookDeliveryRetention: WebhookDeliveryRetentionService })
        .webhookDeliveryRetention,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never,
      attach: (built) => {
        worker = defineModuleWorker('webhooks', built);
        built.on('completed', (job) => {
          completed.push(job.id ?? '');
        });
      },
      onClose: (close) => closers.push(close),
    });
    expect(started).toBe(true);

    expect(await until(async () => !(await exists(due)), 60_000)).toBe(true);
    expect(await exists(recent)).toBe(true);
    expect(await exists(pending)).toBe(true);
  }, 120_000);

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'with webhooks %s no tick runs and the history stays; the tick that waited deletes it once the module is back',
    async (axis) => {
      const due = await delivery('dead_lettered', 400);
      await withModuleOff('webhooks', axis, async () => {
        const job = await queue.add('purge', {});
        // Long enough for a running consumer to have taken it many times over.
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        expect(completed).not.toContain(job.id);
        expect(await exists(due)).toBe(true);
      });
      expect(await until(async () => !(await exists(due)), 60_000)).toBe(true);
    },
    120_000,
  );
});
