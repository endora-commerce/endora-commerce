import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCreditLimitWithActiveReservation } from '../../helpers/seed-credit-limit.js';

/**
 * T211 — Cancelling an order via admin status transition (new|confirmed →
 * cancelled) releases the associated credit-limit reservation with
 * releasedReason='order_cancelled'.
 */

interface CreditLimitView { availableAmount: number }

describe('credit-limit release on order cancellation', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCreditLimitWithActiveReservation(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('available amount grows back after admin cancels the order', async () => {
    const orderId = '00000000-0000-4000-8000-000000000c01';

    const before = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/credit-limit',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const beforeAvailable = (before.json() as { data: CreditLimitView }).data.availableAmount;

    const cancel = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/status`,
      payload: { to: 'cancelled' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(cancel.statusCode).toBe(200);

    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/credit-limit',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect((after.json() as { data: CreditLimitView }).data.availableAmount).toBeGreaterThan(
      beforeAvailable,
    );
  });
});
