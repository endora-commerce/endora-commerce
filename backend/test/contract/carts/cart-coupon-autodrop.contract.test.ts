import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PromotionService } from '../../../src/modules/promotions/services/promotion-service.js';

/**
 * Feature 027 US2 FR-014 — auto-drop coupon on read.
 *
 * A previously-applied coupon is silently dropped on the next GET
 * /api/v1/cart when its eligibility filter no longer matches (e.g. the
 * cart fell below `min_cart_subtotal` after a line removal). The drop
 * is surfaced via `data.couponDroppedThisRead` so the storefront banner
 * can inform the buyer.
 */

describe('GET /api/v1/cart — coupon auto-drop on read', () => {
  let h: BackendServerHandle;
  let promotionService: PromotionService;

  beforeAll(async () => {
    h = await setupBackendServer();
    promotionService = new PromotionService(h.em);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h.em().getConnection().execute('truncate table promotions cascade');
  });

  it('keeps an eligible coupon present on read', async () => {
    await promotionService.upsert({
      code: 'STAY',
      name: 'Stays applied',
      kind: 'percentage_off',
      value: 5,
    });
    const anonToken = `anon-keep-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    const apply = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: JSON.stringify({ code: 'STAY' }),
      headers: { 'content-type': 'application/json' },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(apply.statusCode).toBe(200);

    const read = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(read.statusCode).toBe(200);
    const body = read.json() as {
      data: {
        discount: { code: string } | null;
        couponDroppedThisRead: unknown | null;
      };
    };
    expect(body.data.discount?.code).toBe('STAY');
    expect(body.data.couponDroppedThisRead).toBeNull();
  });

  it('drops a coupon whose min spend is no longer met and reports the drop', async () => {
    // Min spend = 100 PLN. After we add a low-priced line and apply the
    // code, the line price (snapshot) may be lower than the min; we
    // expect the read-side reevaluation to drop the code.
    await promotionService.upsert({
      code: 'BIGMIN',
      name: 'High minimum',
      kind: 'percentage_off',
      value: 10,
      minCartSubtotal: 1, // Apply OK
    });
    const anonToken = `anon-drop-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    const apply = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: JSON.stringify({ code: 'BIGMIN' }),
      headers: { 'content-type': 'application/json' },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(apply.statusCode).toBe(200);

    // Now raise the min spend so the cart no longer qualifies.
    await promotionService.upsert({
      code: 'BIGMIN',
      name: 'High minimum',
      kind: 'percentage_off',
      value: 10,
      minCartSubtotal: 100_000,
    });

    const read = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(read.statusCode).toBe(200);
    const body = read.json() as {
      data: {
        discount: unknown | null;
        couponDroppedThisRead: { code: string; reason: string } | null;
      };
    };
    expect(body.data.couponDroppedThisRead?.code).toBe('BIGMIN');
    expect(body.data.couponDroppedThisRead?.reason).toBe('below_min_spend');
    // After drop, the cart no longer carries the coupon.
    expect(body.data.discount).toBeNull();
  });

  it('drops a coupon whose code was deleted (no longer in promotions table)', async () => {
    await promotionService.upsert({
      code: 'WILLDIE',
      name: 'Soon-deleted',
      kind: 'percentage_off',
      value: 5,
    });
    const anonToken = `anon-deleted-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: JSON.stringify({ code: 'WILLDIE' }),
      headers: { 'content-type': 'application/json' },
      cookies: { b2b_cart_anon: anonToken },
    });

    // Nuke the promotion row.
    await h.em().getConnection().execute(`delete from promotions where code = 'WILLDIE'`);

    const read = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    const body = read.json() as {
      data: { couponDroppedThisRead: { code: string; reason: string } | null };
    };
    expect(body.data.couponDroppedThisRead?.code).toBe('WILLDIE');
    expect(body.data.couponDroppedThisRead?.reason).toBe('invalid_code');
  });
});
