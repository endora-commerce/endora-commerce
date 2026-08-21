import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';

/**
 * Issue #277 — one order is counted as a GA4 `purchase` conversion once.
 *
 * Placing the order opens the claim; the first storefront page the buyer sees
 * it on spends it and reports the conversion; every later view of the same
 * order, on any device, is told the conversion is already counted and reports
 * nothing.
 *
 * The route is the whole of that guarantee: the storefront asks before it
 * fires, so an atomic answer here is what makes a bookmarked gateway-return
 * URL, a reload and a second device add up to one conversion.
 */
describe('POST /api/v1/orders/:id/purchase-conversion — contract', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function placeOrder(): Promise<string> {
    await seedCartForStubCustomer(h.em());
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      cookies: { b2b_session: 'stub-customer-session' },
      headers: { 'content-type': 'application/json' },
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  function claim(orderId: string, session = 'stub-customer-session') {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/purchase-conversion`,
      cookies: { b2b_session: session },
    });
  }

  it('grants the conversion to the first view of a placed order and to no later one', async () => {
    const orderId = await placeOrder();

    const first = await claim(orderId);
    expect(first.statusCode).toBe(200);
    expect((first.json() as { data: { counted: boolean } }).data).toEqual({ counted: true });

    // The buyer comes back to the same order — a bookmarked gateway-return
    // URL, a reload, the order page a week later, a second device.
    const second = await claim(orderId);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { data: { counted: boolean } }).data).toEqual({ counted: false });

    const third = await claim(orderId);
    expect((third.json() as { data: { counted: boolean } }).data).toEqual({ counted: false });
  });

  it('counts two orders separately', async () => {
    const first = await placeOrder();
    const second = await placeOrder();
    expect((await claim(first)).json()).toEqual({ data: { counted: true } });
    expect((await claim(second)).json()).toEqual({ data: { counted: true } });
  });

  it('refuses an order the caller may not read', async () => {
    const orderId = await placeOrder();
    const res = await claim(orderId, 'stub-customer-session-other-org');
    expect([401, 403, 404]).toContain(res.statusCode);
  });

  it('requires an authenticated buyer', async () => {
    const orderId = await placeOrder();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/orders/${orderId}/purchase-conversion`,
    });
    expect(res.statusCode).toBe(401);
  });
});
