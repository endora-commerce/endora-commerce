import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer } from '../../helpers/seed-commerce.js';

/**
 * T104 — SC-003 SLA: an Order placed by a Customer must appear in the Admin
 * Panel's order list within 30 seconds. In-process test → we assert the sync
 * visibility: the Order is returned by GET /admin/orders in the same test.
 */

interface Order { id: string }

describe('orders SLA — admin visibility < 30s', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a newly placed order appears immediately on GET /admin/orders', async () => {
    // Fixture: a customer with a non-empty cart + default address. Placed
    // order shows up synchronously on admin list with status='new'.
    const place = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: '00000000-0000-4000-8000-0000000000f1',
      },
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(place.statusCode).toBe(201);
    const order = (place.json() as { data: Order }).data;
    const t0 = Date.now();

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/orders',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(list.statusCode).toBe(200);
    expect(Date.now() - t0).toBeLessThan(30_000);
    const body = list.json() as { data: Order[] };
    expect(body.data.some((o) => o.id === order.id)).toBe(true);
  });
});
