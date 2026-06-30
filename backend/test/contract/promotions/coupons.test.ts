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

  it('bulk-deactivates and re-activates selected coupons', async () => {
    const id = await createCouponPromotion();
    const codes = ['BULK1', 'BULK2', 'BULK3'];
    for (const code of codes) {
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/promotions/${id}/coupons`,
        cookies: adminCookie,
        payload: { code },
      });
    }
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/promotions/${id}/coupons`,
      cookies: adminCookie,
    });
    const rows = (list.json() as { data: Array<{ id: string; code: string; isActive: boolean }> }).data;
    const ids = rows.slice(0, 2).map((r) => r.id);

    const off = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotions/${id}/coupons/bulk-active`,
      cookies: adminCookie,
      payload: { couponIds: ids, isActive: false },
    });
    expect(off.statusCode).toBe(200);
    expect((off.json() as { data: { updated: number } }).data.updated).toBe(2);

    const afterOff = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/promotions/${id}/coupons`,
      cookies: adminCookie,
    });
    const byId = new Map(
      (afterOff.json() as { data: Array<{ id: string; isActive: boolean }> }).data.map((r) => [r.id, r.isActive]),
    );
    expect(byId.get(ids[0]!)).toBe(false);
    expect(byId.get(ids[1]!)).toBe(false);
    // The unselected coupon stays active.
    expect([...byId.values()].filter((a) => a).length).toBe(1);

    const on = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/promotions/${id}/coupons/bulk-active`,
      cookies: adminCookie,
      payload: { couponIds: ids, isActive: true },
    });
    expect(on.statusCode).toBe(200);
    const afterOn = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/promotions/${id}/coupons`,
      cookies: adminCookie,
    });
    expect(
      (afterOn.json() as { data: Array<{ isActive: boolean }> }).data.every((r) => r.isActive),
    ).toBe(true);
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
