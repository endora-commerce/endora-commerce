import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  orderCommittedWritePartialResponseSchema,
  orderSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * `specs/142-order-transition-atomicity/` — FR-002 at the last place it could
 * still fail: the reads a status route makes for its response body, after the
 * transition has committed.
 *
 * The failure is injected where it was measured — the response serialiser's
 * read of the order's lines — on the route itself, not on the helper: what is
 * asserted is what a client receives, and that the published schema describes
 * it.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BUYER = { cookies: { b2b_session: 'stub-customer-session' } };

type Find = (entity: unknown, ...rest: unknown[]) => Promise<unknown>;

describe('a status route whose response cannot be read back (spec 142, FR-002)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h
      .em()
      .execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [
        SEED_PRODUCT_101_ID,
      ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  /**
   * The next read of an order's lines through the ORM fails, once. That read is
   * the first statement of the response serialiser; nothing on the write path
   * makes it (the release reads `order_items` in SQL).
   */
  function failNextOrderLinesRead(): { fired: () => boolean } {
    let fired = false;
    let holder: object | null = Object.getPrototypeOf(h.em()) as object;
    while (holder && !Object.prototype.hasOwnProperty.call(holder, 'find')) {
      holder = Object.getPrototypeOf(holder) as object | null;
    }
    const proto = holder as { find: Find };
    const original = proto.find;
    vi.spyOn(proto, 'find').mockImplementation(function (this: unknown, entity, ...rest) {
      const name = typeof entity === 'function' ? entity.name : String(entity);
      if (!fired && name === 'OrderItem') {
        fired = true;
        return Promise.reject(new Error('Knex: Timeout acquiring a connection.'));
      }
      return original.call(this, entity, ...rest);
    } as Find);
    return { fired: () => fired };
  }

  const statusOf = async (orderId: string): Promise<{ status: string; payment_status: string }> =>
    (
      (await h
        .em()
        .getConnection()
        .execute(`select "status", "payment_status" from "orders" where "id" = ?`, [orderId])) as Array<{
        status: string;
        payment_status: string;
      }>
    )[0]!;

  it('answers 200 with what was written, marked partial — and the published schema accepts it', async () => {
    const orderId = await place();
    const injected = failNextOrderLinesRead();

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/status`,
      payload: { to: 'cancelled' },
      ...ADMIN,
    });

    expect(injected.fired()).toBe(true);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown>; meta?: unknown };
    expect(body).toEqual({
      data: {
        id: orderId,
        businessId: expect.any(String) as unknown as string,
        status: 'cancelled',
        paymentStatus: (await statusOf(orderId)).payment_status,
      },
      meta: { partial: true },
    });
    // The change did happen, and the reply says so truthfully.
    expect((await statusOf(orderId)).status).toBe('cancelled');
    // Described by the contract — and not mistakable for a whole order.
    expect(orderCommittedWritePartialResponseSchema.safeParse(body).success).toBe(true);
    expect(orderSchema.safeParse(body.data).success).toBe(false);
  });

  it('the same route answers the whole order when nothing fails', async () => {
    const orderId = await place();

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/status`,
      payload: { to: 'cancelled' },
      ...ADMIN,
    });

    const body = res.json() as { data: Record<string, unknown>; meta?: unknown };
    expect(res.statusCode).toBe(200);
    expect(body.meta).toBeUndefined();
    expect(Array.isArray(body.data['items'])).toBe(true);
    expect(orderCommittedWritePartialResponseSchema.safeParse(body).success).toBe(false);
  });

  it('the payment-status route and the buyer`s cancel route answer the same way', async () => {
    const toPay = await place();
    const paidInjection = failNextOrderLinesRead();
    const paid = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${toPay}/payment-status`,
      payload: { to: 'paid' },
      ...ADMIN,
    });
    expect(paidInjection.fired()).toBe(true);
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({
      data: { id: toPay, paymentStatus: 'paid' },
      meta: { partial: true },
    });
    vi.restoreAllMocks();

    const toCancel = await place();
    const cancelInjection = failNextOrderLinesRead();
    const cancelled = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${toCancel}/cancel`,
      ...BUYER,
    });
    expect(cancelInjection.fired()).toBe(true);
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({
      data: { id: toCancel, status: 'cancelled' },
      meta: { partial: true },
    });
    expect((await statusOf(toCancel)).status).toBe('cancelled');
  });
});
