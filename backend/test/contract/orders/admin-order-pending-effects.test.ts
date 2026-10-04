import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { orderSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * `pendingEffects` on the admin order response
 * (`specs/142-order-transition-atomicity/`, D10, FR-019).
 *
 * A release the platform is still retrying, or that is waiting for a
 * switched-off module, is visible to the operator on the order — and only
 * there. The buyer-facing reads never carry it.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };

interface OrderBody {
  data: Record<string, unknown> & { status: string; pendingEffects?: unknown };
}

describe('admin order response — pendingEffects (spec 142, T16)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h
      .em()
      .execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [
        SEED_PRODUCT_101_ID,
      ]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function place(): Promise<string> {
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      ...BUYER,
    });
    expect(add.statusCode).toBe(200);
    const placed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
      ...BUYER,
    });
    expect(placed.statusCode, placed.body).toBe(201);
    return (placed.json() as { data: { id: string } }).data.id;
  }

  const adminRead = async (orderId: string): Promise<OrderBody['data']> =>
    ((await h.app.inject({ method: 'GET', url: `/api/v1/admin/orders/${orderId}`, ...ADMIN })).json() as OrderBody)
      .data;

  const cancel = (orderId: string) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/status`,
      payload: { to: 'cancelled' },
      ...ADMIN,
    });

  it('is absent from an order that owes nothing', async () => {
    const orderId = await place();

    expect(await adminRead(orderId)).not.toHaveProperty('pendingEffects');
  });

  it('is absent once a cancellation`s follow-ups have completed', async () => {
    const orderId = await place();

    const res = await cancel(orderId);

    expect((res.json() as OrderBody).data).not.toHaveProperty('pendingEffects');
    expect(await adminRead(orderId)).not.toHaveProperty('pendingEffects');
  });

  it('names the release and the module it is waiting for, on the transition reply and on the read', async () => {
    const orderId = await place();

    const res = await withModuleOff('inventory', 'deactivated', () => cancel(orderId));
    const waiting = [
      { effect: 'stock.release', blockedOn: 'inventory', attempts: 0, lastAttemptAt: null },
    ];

    expect(res.statusCode).toBe(200);
    expect((res.json() as OrderBody).data.pendingEffects).toEqual(waiting);
    const read = await adminRead(orderId);
    expect(read.pendingEffects).toEqual(waiting);
    // The published schema describes what the route answers.
    expect(orderSchema.shape.pendingEffects.parse(read.pendingEffects)).toEqual(waiting);
  });

  it('reports how often a failing release has been attempted, and when', async () => {
    const orderId = await place();
    await h.em().getConnection().execute(
      `insert into "order_transition_effects"
         ("id", "organization_id", "order_id", "effect", "reason", "origin",
          "attempts", "last_error", "last_attempt_at", "next_attempt_at", "created_at", "updated_at")
       select gen_random_uuid(), o."organization_id", o."id", 'credit.release', 'order_cancelled',
              'transition', 3, 'lock timeout', '2026-10-03T10:05:00Z', now() + interval '1 hour',
              now(), now()
         from "orders" o where o."id" = ?`,
      [orderId],
    );

    expect((await adminRead(orderId)).pendingEffects).toEqual([
      {
        effect: 'credit.release',
        blockedOn: null,
        attempts: 3,
        lastAttemptAt: '2026-10-03T10:05:00.000Z',
      },
    ]);
  });

  it('is never carried by the buyer-facing order responses', async () => {
    const orderId = await place();
    await withModuleOff('inventory', 'deactivated', () => cancel(orderId));
    // The order does owe something — the admin read says so…
    expect((await adminRead(orderId)).pendingEffects).toHaveLength(1);

    // …and neither buyer read mentions it.
    const one = await h.app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, ...BUYER });
    expect(one.statusCode).toBe(200);
    expect((one.json() as OrderBody).data).not.toHaveProperty('pendingEffects');

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/orders', ...BUYER });
    const mine = (list.json() as { data: Array<Record<string, unknown>> }).data.find(
      (o) => o['id'] === orderId,
    );
    expect(mine).toBeDefined();
    expect(mine).not.toHaveProperty('pendingEffects');
  });
});
