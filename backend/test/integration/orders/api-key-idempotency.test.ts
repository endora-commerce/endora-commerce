import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { OrderPlacementIntent } from '../../../src/modules/orders/entities/order-placement-intent.entity.js';

/**
 * Feature 062 / T021 — durable order-intake idempotency (SC-003, FR-012):
 *  - same key + same payload replay ⇒ 200 with the SAME order (no duplicate);
 *  - same key + different payload ⇒ 409 IDEMPOTENCY_KEY_REUSED;
 *  - concurrent duplicate POSTs ⇒ exactly one order (per-key Redis lock; a
 *    lock-busy loser retries and lands on the winner's order);
 *  - a `failed` intent re-attempts and can succeed;
 *  - the intent is a durable DB row (`order_placement_intents`), not Redis.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('external order intake — idempotency (062 / T021)', () => {
  let h: BackendServerHandle;
  let token: string;

  const payload = () => ({
    lines: [{ sku: 'EXAMPLE-SIMPLE-001', quantity: 1 }],
    deliveryMethodId: SEED_DELIVERY_METHOD_ID,
    paymentMethodId: SEED_PAYMENT_METHOD_ID,
    deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
    billingAddressId: SEED_ADDRESS_BILLING_ID,
  });

  const post = (body: Record<string, unknown>, idempotencyKey: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/external/orders',
      payload: body,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': idempotencyKey,
      },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code: 'ext-idem',
      name: { 'en-US': 'Idempotency channel' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      isPublic: true,
    });
    await em.persistAndFlush(channel);
    await h.salesChannels.cache.invalidate('ext-idem');
    await em.getConnection().execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?)`,
      [channel.id, SEED_PRODUCT_101_ID],
    );

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload: {
        name: 'Idempotency key',
        scopes: ['orders:read', 'orders:write'],
        binding: {
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: channel.id,
          customerAccountId: TEST_CUSTOMER_ID,
        },
      },
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(201);
    token = (res.json() as { data: { bearerToken: string } }).data.bearerToken;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('same key + same payload ⇒ 200 with the original order; one orders row; durable intent row', async () => {
    const key = `replay-${randomUUID()}`;
    const first = await post(payload(), key);
    expect(first.statusCode).toBe(201);
    const firstOrder = (first.json() as { data: { id: string } }).data;

    const second = await post(payload(), key);
    expect(second.statusCode).toBe(200);
    const secondOrder = (second.json() as { data: { id: string } }).data;
    expect(secondOrder.id).toBe(firstOrder.id);

    const count = await h.em().count(Order, { id: firstOrder.id });
    expect(count).toBe(1);

    // Durability: the idempotency record is a DB row (survives restarts),
    // not just Redis state.
    const intent = await h.em().findOne(OrderPlacementIntent, {
      idempotencyKey: key,
    });
    expect(intent).not.toBeNull();
    expect(intent!.status).toBe('succeeded');
    expect(intent!.orderId).toBe(firstOrder.id);
    expect(intent!.organizationId).toBe(TEST_ORGANIZATION_ID);
  });

  it('same key + different payload ⇒ 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = `reuse-${randomUUID()}`;
    const first = await post(payload(), key);
    expect(first.statusCode).toBe(201);

    const res = await post(
      { ...payload(), lines: [{ sku: 'EXAMPLE-SIMPLE-001', quantity: 3 }] },
      key,
    );
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
    );
  });

  it('concurrent duplicate POSTs ⇒ exactly one order; the busy loser replays onto it', async () => {
    const key = `race-${randomUUID()}`;
    const ordersBefore = await h.em().count(Order, {});

    const [a, b] = await Promise.all([post(payload(), key), post(payload(), key)]);
    const statuses = [a.statusCode, b.statusCode].sort((x, y) => x - y);
    // One caller placed (201). The other was serialized: either it replayed the
    // finished intent (200) or hit the per-key lock (409 intake_busy).
    expect(statuses).toContain(201);

    const winner = a.statusCode === 201 ? a : b;
    const loser = a.statusCode === 201 ? b : a;
    const winnerOrder = (winner.json() as { data: { id: string } }).data;

    if (loser.statusCode === 200) {
      expect((loser.json() as { data: { id: string } }).data.id).toBe(winnerOrder.id);
    } else {
      expect(loser.statusCode).toBe(409);
      const err = (loser.json() as {
        error: { code: string; details?: Record<string, unknown> };
      }).error;
      expect(err.details).toMatchObject({ code: 'intake_busy' });
      // Retrying the same request is idempotency-safe: it lands on the
      // winner's order.
      const retry = await post(payload(), key);
      expect(retry.statusCode).toBe(200);
      expect((retry.json() as { data: { id: string } }).data.id).toBe(winnerOrder.id);
    }

    const ordersAfter = await h.em().count(Order, {});
    expect(ordersAfter).toBe(ordersBefore + 1);
  });

  it('a failed intent re-attempts under the same key and can succeed', async () => {
    const key = `retry-${randomUUID()}`;
    const conn = h.em().getConnection();

    // Drain stock so the first attempt fails inside placeOrder.
    await conn.execute(`update stock_levels set on_hand = 0, reserved = 0 where product_id = ?`, [
      SEED_PRODUCT_101_ID,
    ]);
    const failed = await post(payload(), key);
    expect(failed.statusCode).toBe(409);
    expect((failed.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.STOCK_UNAVAILABLE,
    );
    const em1 = h.em();
    const intent = await em1.findOne(OrderPlacementIntent, { idempotencyKey: key });
    expect(intent!.status).toBe('failed');

    // Restock; the SAME key + payload re-attempts and succeeds.
    await conn.execute(
      `update stock_levels set on_hand = 100, reserved = 0 where product_id = ?`,
      [SEED_PRODUCT_101_ID],
    );
    const retry = await post(payload(), key);
    expect(retry.statusCode).toBe(201);
    const em2 = h.em();
    em2.clear();
    const settled = await em2.findOne(OrderPlacementIntent, { idempotencyKey: key });
    expect(settled!.status).toBe('succeeded');
    expect(settled!.orderId).toBe((retry.json() as { data: { id: string } }).data.id);
  });
});
