import { describe, expect, it } from 'vitest';
import { createDeliveryProcessor } from '../../../src/modules/webhooks/services/webhook-delivery-worker.js';
import type { WebhookJobData } from '../../../src/modules/webhooks/services/webhook-queue.js';

/**
 * T222 — A receiver returning non-2xx makes the processor throw, which is
 * exactly what BullMQ needs to schedule the next exponential-backoff retry.
 * After exhausting retries (default 8) the job lands in BullMQ's `failed`
 * queue — that's the dead-letter signal consumed by the admin "failed
 * deliveries" view.
 *
 * This test asserts the throw-on-non-2xx contract directly; the BullMQ
 * retry counter is owned by the queue runtime, not by us.
 */

describe('webhook delivery — non-2xx triggers retry signal', () => {
  it('throws on 5xx so BullMQ schedules the next attempt', async () => {
    const fakeFetch: typeof fetch = async () => new Response('boom', { status: 503 });
    const processor = createDeliveryProcessor({ fetchFn: fakeFetch });
    const job: { data: WebhookJobData; attemptsMade: number } = {
      data: {
        webhookId: 'wh_test',
        eventId: 'evt_retry',
        eventType: 'order.created.v1',
        payload: { ok: false },
        url: 'https://receiver.example.com/hooks',
        secret: 'secret',
      },
      attemptsMade: 0,
    };

    await expect(
      processor(job as unknown as Parameters<typeof processor>[0]),
    ).rejects.toThrow(/503/);
  });

  it('throws on 4xx the same way (BullMQ retries permanently-failing receivers too)', async () => {
    const fakeFetch: typeof fetch = async () => new Response('forbidden', { status: 403 });
    const processor = createDeliveryProcessor({ fetchFn: fakeFetch });
    const job: { data: WebhookJobData; attemptsMade: number } = {
      data: {
        webhookId: 'wh_test',
        eventId: 'evt_retry_4xx',
        eventType: 'order.created.v1',
        payload: { ok: false },
        url: 'https://receiver.example.com/hooks',
        secret: 'secret',
      },
      attemptsMade: 7, // last attempt before BullMQ dead-letters
    };

    await expect(
      processor(job as unknown as Parameters<typeof processor>[0]),
    ).rejects.toThrow(/403/);
  });
});
