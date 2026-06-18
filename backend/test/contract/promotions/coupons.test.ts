import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 045 (US3) — single coupon creation + redemption gating. A promotion
 * carrying a coupon applies only when the matching code is presented.
 */
describe('Promotion coupons (feature 045)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });
  beforeEach(async () => {
    await h.em().getConnection().execute('truncate table promotions cascade');
  });

  async function createCouponPromotion(): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: adminCookie,
      payload: {
        name: 'coupon 10%',
        action: { type: 'percentage_off_cart', percent: 10 },
        rule: { kind: 'all' },
      },
    });
    return (res.json() as { data: { id: string } }).data.id;
  }

  const previewPayload = (code?: string) => ({
    organizationId: null,
    customerGroupId: null,
    currency: 'PLN',
    deliveryTotal: 0,
    ...(code ? { promotionCode: code } : {}),
    lines: [
      { productId: '00000000-0000-4000-8000-000000000001', variantId: null, categoryIds: [], quantity: 1, unitPrice: { amount: 200, currency: 'PLN' } },
    ],
  });

  it('creates a single coupon and rejects duplicates', async () => {
    const id = await createCouponPromotion();
    const ok = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotions/${id}/coupons`,
      cookies: adminCookie,
      payload: { code: 'WELCOME10' },
    });
    expect(ok.statusCode).toBe(201);

    const dup = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotions/${id}/coupons`,
      cookies: adminCookie,
      payload: { code: 'WELCOME10' },
    });
    expect(dup.statusCode).toBe(409);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/promotions/${id}/coupons`,
      cookies: adminCookie,
    });
    expect((list.json() as { data: unknown[] }).data).toHaveLength(1);
  });

  it('applies only when the matching code is presented', async () => {
    const id = await createCouponPromotion();
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotions/${id}/coupons`,
      cookies: adminCookie,
      payload: { code: 'WELCOME10' },
    });

    // No code → couponed promotion is gated out.
    const without = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions/preview',
      cookies: adminCookie,
      payload: previewPayload(),
    });
    expect((without.json() as { data: { discountTotal: number } }).data.discountTotal).toBe(0);

    // Correct code → applies, with couponId stamped.
    const withCode = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions/preview',
      cookies: adminCookie,
      payload: previewPayload('WELCOME10'),
    });
    const body = withCode.json() as {
      data: { discountTotal: number; appliedPromotions: Array<{ couponId: string | null }> };
    };
    expect(body.data.discountTotal).toBe(20);
    expect(body.data.appliedPromotions[0]?.couponId).toBeTruthy();

    // Wrong code → no discount.
    const wrong = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions/preview',
      cookies: adminCookie,
      payload: previewPayload('NOPE'),
    });
    expect((wrong.json() as { data: { discountTotal: number } }).data.discountTotal).toBe(0);
  });
});
