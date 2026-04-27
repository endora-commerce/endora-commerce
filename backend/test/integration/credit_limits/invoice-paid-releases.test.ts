import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCreditLimitWithActiveReservation } from '../../helpers/seed-credit-limit.js';

/**
 * T210 — Marking an order's payment as `paid` releases the associated
 * credit-limit reservation. The available amount on /me/credit-limit grows
 * back by the order total.
 */

interface CreditLimitView { availableAmount: number; activeReservations: unknown[] }

describe('credit-limit release on invoice paid', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCreditLimitWithActiveReservation(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('available amount grows back after admin marks payment as paid', async () => {
    const orderId = '00000000-0000-4000-8000-000000000c01';
    const orgId = '00000000-0000-4000-8000-0000000000aa';

    const before = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/credit-limit',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const beforeAvailable = (before.json() as { data: CreditLimitView }).data.availableAmount;

    const transition = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/payment-status`,
      payload: { to: 'paid' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(transition.statusCode).toBe(200);

    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/credit-limit',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const afterBody = (after.json() as { data: CreditLimitView }).data;
    expect(afterBody.availableAmount).toBeGreaterThan(beforeAvailable);
    expect(afterBody.activeReservations).toHaveLength(0);
    void orgId;
  });
});
