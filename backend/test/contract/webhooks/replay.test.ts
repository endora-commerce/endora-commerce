import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Webhook, WebhookDelivery } from '../../helpers/package-entities.js';

/**
 * T232 — failed-deliveries replay surface.
 *
 * `POST /admin/webhooks/deliveries/:id/replay` copies a `failed` or
 * `dead_lettered` delivery into a fresh `pending` row referencing the same
 * event/payload, returning 202. Replay on any other status is rejected with
 * `WEBHOOK_DELIVERY_NOT_REPLAYABLE`.
 */

describe('POST /admin/webhooks/deliveries/:id/replay', () => {
  let h: BackendServerHandle;
  let webhookId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const w = em.create(Webhook, {
      name: 'replay-test',
      url: 'https://receiver.example.com/hooks',
      eventTypes: ['order.created.v1'],
      secret: 'a'.repeat(64),
    });
    await em.persistAndFlush(w);
    webhookId = w.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 202 and creates a new pending delivery from a dead-lettered source', async () => {
    const em = h.em();
    const dead = em.create(WebhookDelivery, {
      webhookId,
      eventId: 'evt_replay_1',
      eventType: 'order.created.v1',
      payload: { orderId: 'o-replay-1' },
      status: 'dead_lettered',
      attemptCount: 8,
      lastError: 'receiver returned 500',
    });
    await em.persistAndFlush(dead);

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/webhooks/deliveries/${dead.id}/replay`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { data: { id: string; status: string; attemptCount: number } };
    expect(body.data.id).not.toBe(dead.id);
    expect(body.data.status).toBe('pending');
    expect(body.data.attemptCount).toBe(0);

    const fresh = await h.em().findOne(WebhookDelivery, { id: body.data.id });
    expect(fresh?.eventId).toBe('evt_replay_1');
    expect(fresh?.eventType).toBe('order.created.v1');
  });

  it('rejects replay of an already-pending delivery with WEBHOOK_DELIVERY_NOT_REPLAYABLE', async () => {
    const em = h.em();
    const pending = em.create(WebhookDelivery, {
      webhookId,
      eventId: 'evt_replay_pending',
      eventType: 'order.created.v1',
      payload: {},
      status: 'pending',
      attemptCount: 0,
    });
    await em.persistAndFlush(pending);

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/webhooks/deliveries/${pending.id}/replay`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.WEBHOOK_DELIVERY_NOT_REPLAYABLE,
    );
  });
});
