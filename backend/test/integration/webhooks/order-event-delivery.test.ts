import type { WebhookService } from '../../../../packages/modules/webhooks/src/backend/services/webhook-service.js';
import { Organization } from '../../helpers/package-entities.js';
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Queue, Worker } from 'bullmq';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  createWebhookQueue,
  createWebhookWorker,
  type WebhookJobData,
} from '../../../../packages/modules/webhooks/src/backend/services/webhook-queue.js';
import { createDeliveryProcessor } from '../../../../packages/modules/webhooks/src/backend/services/webhook-delivery-worker.js';
import { bridgeEventHandler } from '../../../../packages/modules/webhooks/src/backend/services/event-bridge.js';
import { BRIDGED_EVENT_TYPES } from '../../../../packages/modules/webhooks/src/backend/index.js';
import { emitOrderStatusAfter } from '../../../src/modules/orders/events/order-status-events.js';
import { WebhookDelivery, type WebhookDeliveryRow } from '../../helpers/package-entities.js';

/**
 * Feature 062 / T028 — org-scoped webhook delivery, end to end (SC-006;
 * contracts/order-webhooks.md §5). Real BullMQ queue + delivery worker over
 * the test Redis (unique prefix per run), real event bridge + subscription
 * lookup; only the outbound HTTP POST is faked.
 *
 * Matrix:
 *  - order event for org A → org-A + platform-wide subscriptions receive the
 *    delivery; org-B subscription receives nothing; paused subscription silent;
 *  - HMAC signature over the exact body verifies with the subscription secret;
 *  - endpoint returns 500 then recovers → retried per policy, final delivery
 *    recorded on `webhook_deliveries` (failed attempt row + succeeded row);
 *  - `order.status_changed.v1` payload carries organizationId, the new status,
 *    and businessId;
 *  - event without organizationId → platform-wide only (fail closed).
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const ORG_B_ID = '00000000-0000-4000-8000-000000006200';

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

async function waitFor(cond: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Feature 072 (T098) — `webhooks` owns its service now, so it is resolved from
 * the container rather than off the `api_keys` handle it used to be built on.
 */
function webhookServiceOf(handle: BackendServerHandle): WebhookService {
  return (handle.container.cradle as unknown as { webhookService: WebhookService })
    .webhookService;
}

describe('webhook delivery — org-scoped order events (062/T028)', () => {
  let h: BackendServerHandle;
  let queue: Queue<WebhookJobData>;
  let worker: Worker<WebhookJobData>;
  let unwire: () => void;

  const captured: CapturedRequest[] = [];
  /** URLs that fail with 500 exactly N more times before succeeding. */
  const failuresLeft = new Map<string, number>();

  const secrets = new Map<string, string>(); // url → secret
  const hookIds = new Map<string, string>(); // url → webhook id

  const URL_ORG_A = 'https://receiver.example.com/org-a';
  const URL_ORG_B = 'https://receiver.example.com/org-b';
  const URL_PLATFORM = 'https://receiver.example.com/platform';
  const URL_PAUSED = 'https://receiver.example.com/paused';
  const URL_FLAKY = 'https://receiver.example.com/flaky';

  const createHook = async (input: {
    name: string;
    url: string;
    organizationId?: string;
    eventTypes?: string[];
  }): Promise<{ id: string; secret: string }> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/webhooks',
      payload: {
        name: input.name,
        url: input.url,
        eventTypes: input.eventTypes ?? ['order.created.v1', 'order.status_changed.v1'],
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      },
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(201);
    const data = (res.json() as { data: { id: string; secret: string } }).data;
    secrets.set(input.url, data.secret);
    hookIds.set(input.url, data.id);
    return data;
  };

  const emitOrderCreated = async (payload: Record<string, unknown>): Promise<string> => {
    const eventId = randomUUID();
    await h.eventBus.run(async () => {
      h.eventBus.emit('order.created.v1', {
        eventId,
        occurredAt: new Date().toISOString(),
        ...payload,
      });
    });
    return eventId;
  };

  const urlsHit = (): string[] => captured.map((c) => c.url);

  beforeAll(async () => {
    h = await setupBackendServer();

    const em = h.em();
    em.create(Organization, {
      id: ORG_B_ID,
      name: 'Webhook Org B',
      taxId: 'PL0000006200',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Testowa 62',
        city: 'Warszawa',
        postalCode: '00-062',
        country: 'PL',
      },
    });
    await em.flush();

    await createHook({ name: 'S1 org A', url: URL_ORG_A, organizationId: TEST_ORGANIZATION_ID });
    await createHook({ name: 'S2 org B', url: URL_ORG_B, organizationId: ORG_B_ID });
    await createHook({ name: 'S3 platform', url: URL_PLATFORM });
    await createHook({ name: 'S5 flaky', url: URL_FLAKY });
    const paused = await createHook({ name: 'S4 paused', url: URL_PAUSED });
    const pauseRes = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/webhooks/${paused.id}`,
      payload: { status: 'paused' },
      cookies: ADMIN_COOKIE,
    });
    expect(pauseRes.statusCode).toBe(200);

    // Real queue + worker over the test Redis, isolated by a per-run prefix
    // and tightened retry policy so the retry case settles quickly.
    const prefix = `test-webhooks-${randomUUID().slice(0, 8)}`;
    queue = createWebhookQueue(h.redis, {
      prefix,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'fixed', delay: 100 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
      },
    });

    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      captured.push({
        url,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: String(init?.body ?? ''),
      });
      const remaining = failuresLeft.get(url) ?? 0;
      if (remaining > 0) {
        failuresLeft.set(url, remaining - 1);
        return new Response('boom', { status: 500 });
      }
      return new Response('', { status: 200 });
    };

    const processor = createDeliveryProcessor({
      fetchFn: fakeFetch,
      recordDelivery: async (input) => {
        await webhookServiceOf(h).recordDelivery(input);
      },
    });
    worker = createWebhookWorker(h.redis, processor, { prefix, concurrency: 2 });

    // The module's own registrations live in `webhooks/backend.ts` and go
    // through `ctx.subscribe`. This file drives the bridge against a queue of
    // its own, so it attaches the same handler to the composed bus itself.
    const offs = BRIDGED_EVENT_TYPES.map((eventType) =>
      h.eventBus.on(
        eventType,
        bridgeEventHandler(eventType, { queue, subscriptionLookup: webhookServiceOf(h) }),
      ),
    );
    unwire = () => offs.forEach((off) => off());
  }, 60_000);

  afterAll(async () => {
    unwire();
    await worker.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await teardownBackendServer(h);
  });

  it('delivers an org-A order event to the org-A + platform subscriptions only, HMAC-signed', async () => {
    captured.length = 0;
    // Confine to the non-flaky receivers by pausing the flaky one for this case.
    failuresLeft.set(URL_FLAKY, 0);

    const eventId = await emitOrderCreated({
      orderId: randomUUID(),
      organizationId: TEST_ORGANIZATION_ID,
    });

    await waitFor(() => urlsHit().includes(URL_ORG_A) && urlsHit().includes(URL_PLATFORM));
    // Let any stray deliveries land before asserting the negatives.
    await new Promise((r) => setTimeout(r, 300));

    expect(urlsHit()).not.toContain(URL_ORG_B);
    expect(urlsHit()).not.toContain(URL_PAUSED);

    const hit = captured.find((c) => c.url === URL_ORG_A)!;
    expect(hit.headers['X-Webhook-Event-Id']).toBe(eventId);
    expect(hit.headers['X-Webhook-Event-Type']).toBe('order.created.v1');
    const expectedSig = createHmac('sha256', secrets.get(URL_ORG_A)!)
      .update(hit.body, 'utf8')
      .digest('hex');
    expect(hit.headers['X-Webhook-Signature-256']).toBe(expectedSig);
    const payload = JSON.parse(hit.body) as { organizationId: string };
    expect(payload.organizationId).toBe(TEST_ORGANIZATION_ID);
  });

  it('order.status_changed.v1 payload carries organizationId, the new status, and businessId', async () => {
    captured.length = 0;

    await h.eventBus.run(async () => {
      emitOrderStatusAfter(h.eventBus, {
        orderId: randomUUID(),
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: randomUUID(),
        from: 'new',
        to: 'processing',
        actor: { kind: 'system' },
        businessId: 'ORD-2026-000062',
      });
    });

    await waitFor(() => urlsHit().includes(URL_ORG_A) && urlsHit().includes(URL_PLATFORM));
    await new Promise((r) => setTimeout(r, 300));
    expect(urlsHit()).not.toContain(URL_ORG_B);

    const hit = captured.find((c) => c.url === URL_ORG_A)!;
    expect(hit.headers['X-Webhook-Event-Type']).toBe('order.status_changed.v1');
    const payload = JSON.parse(hit.body) as {
      organizationId: string;
      to: string;
      businessId: string;
    };
    expect(payload.organizationId).toBe(TEST_ORGANIZATION_ID);
    expect(payload.to).toBe('processing');
    expect(payload.businessId).toBe('ORD-2026-000062');
  });

  it('retries a 500 endpoint and records the final delivery on webhook_deliveries', async () => {
    captured.length = 0;
    failuresLeft.set(URL_FLAKY, 1); // fail once, then recover

    const eventId = await emitOrderCreated({
      orderId: randomUUID(),
      organizationId: ORG_B_ID, // reaches S2 + S3 + flaky S5 (platform-wide)
    });

    await waitFor(() => captured.filter((c) => c.url === URL_FLAKY).length >= 2);

    const flakyId = hookIds.get(URL_FLAKY)!;
    // recordDelivery flushes out-of-band; poll until the succeeded row lands.
    let rows: WebhookDeliveryRow[] = [];
    const deadline = Date.now() + 10_000;
    do {
      await new Promise((r) => setTimeout(r, 100));
      rows = await h.em().find(WebhookDelivery, { webhookId: flakyId, eventId });
    } while (!rows.some((r) => r.status === 'succeeded') && Date.now() < deadline);
    const statuses = rows.map((r) => r.status).sort();
    expect(statuses).toContain('failed');
    expect(statuses).toContain('succeeded');
    const succeeded = rows.find((r) => r.status === 'succeeded')!;
    expect(succeeded.attemptCount).toBe(2);
    expect(succeeded.eventType).toBe('order.created.v1');

    // Org filtering held during the retry case too.
    expect(urlsHit()).toContain(URL_ORG_B);
    expect(urlsHit()).not.toContain(URL_ORG_A);
  });

  it('event without organizationId reaches platform-wide subscriptions only (fail closed)', async () => {
    captured.length = 0;

    await emitOrderCreated({ orderId: randomUUID() });

    await waitFor(() => urlsHit().includes(URL_PLATFORM));
    await new Promise((r) => setTimeout(r, 300));

    expect(urlsHit()).not.toContain(URL_ORG_A);
    expect(urlsHit()).not.toContain(URL_ORG_B);
  });
});
