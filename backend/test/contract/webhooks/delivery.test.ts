import { createHmac } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeliveryProcessor } from '../../../src/modules/webhooks/services/webhook-delivery-worker.js';
import type { WebhookJobData } from '../../../src/modules/webhooks/services/webhook-queue.js';

/**
 * T221 — Webhook delivery completes in ≤ 5s and the receiver can verify the
 * HMAC signature using the shared secret.
 *
 * The worker (`createDeliveryProcessor`) is exercised directly with a
 * fake-fetch — that's the canonical place where signing happens, and lets
 * the test assert headers without standing up a real HTTP listener.
 */

describe('webhook delivery — HMAC signature', () => {
  let receivedHeaders: Record<string, string> | undefined;
  let receivedBody: string | undefined;

  beforeAll(async () => {
    // no-op: vitest needs a beforeAll for `afterAll` symmetry
  });

  afterAll(async () => {
    // no-op
  });

  it('signs the payload with HMAC-SHA-256 and posts within timeout', async () => {
    const secret = 'webhook-test-secret';
    const eventId = 'evt_2026_test_123';
    const eventType = 'order.created.v1';
    const payload = { event: { id: eventId, type: eventType }, data: { orderId: 'o1' } };

    const fakeFetch: typeof fetch = async (_input, init) => {
      receivedHeaders = init!.headers as Record<string, string>;
      receivedBody = init!.body as string;
      return new Response('', { status: 200 });
    };

    const processor = createDeliveryProcessor({ fetchFn: fakeFetch, timeoutMs: 5_000 });
    const job: { data: WebhookJobData; attemptsMade: number } = {
      data: {
        webhookId: 'wh_test',
        eventId,
        eventType,
        payload,
        url: 'https://receiver.example.com/hooks',
        secret,
      },
      attemptsMade: 0,
    };

    const start = Date.now();
    // The processor's signature accepts a BullMQ Job; tests pass a structural
    // double with just the fields the worker reads.
    await processor(job as unknown as Parameters<typeof processor>[0]);
    expect(Date.now() - start).toBeLessThan(5_000);

    expect(receivedHeaders!['X-Webhook-Event-Id']).toBe(eventId);
    expect(receivedHeaders!['X-Webhook-Event-Type']).toBe(eventType);
    expect(receivedHeaders!['X-Webhook-Attempt']).toBe('1');
    const expectedSig = createHmac('sha256', secret).update(receivedBody!, 'utf8').digest('hex');
    expect(receivedHeaders!['X-Webhook-Signature-256']).toBe(expectedSig);
  });
});
