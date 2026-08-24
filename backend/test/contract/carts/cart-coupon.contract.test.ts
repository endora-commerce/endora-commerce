import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { PromotionService } from '../../../../packages/modules/promotions/src/backend/services/promotion-service.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';

/**
 * T050 (feature 027 US2) — POST /api/v1/cart/coupon contract.
 *
 * Exercises the apply / replace / clear flows + reason-specific drops.
 * Real PostgreSQL via the backend test rig; promotions are pre-arranged
 * directly through PromotionService.upsert.
 */

describe('POST /api/v1/cart/coupon', () => {
  let h: BackendServerHandle;
  let promotionService: PromotionService;

  beforeAll(async () => {
    h = await setupBackendServer();
    promotionService = promotionServiceFor(h);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h.em().getConnection().execute('truncate table promotions cascade');
  });

  it('returns 422 cart_empty when the cart has no lines', async () => {
    const anonToken = `anon-coupon-empty-${Date.now()}`;
    await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: JSON.stringify({ code: 'WIOSNA10' }),
      headers: { 'content-type': 'application/json' },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('CART_EMPTY');
  });

  it('returns 422 CART_COUPON_REJECTED reason=invalid_code on a missing code', async () => {
    const anonToken = `anon-coupon-bad-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add.statusCode).toBe(200);

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: { code: 'NOTACODE' },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as {
      error: { code: string; message: string; details: { reason: string } };
    };
    expect(body.error.code).toBe('CART_COUPON_REJECTED');
    expect(body.error.details.reason).toBe('invalid_code');
  });

  it('applies an automatic-style code when its criteria are met', async () => {
    await promotionService.upsert({
      code: 'BIGSAVE',
      name: 'Big save',
      kind: 'percentage_off',
      value: 10,
    });

    const anonToken = `anon-coupon-ok-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 2 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add.statusCode).toBe(200);

    const apply = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: { code: 'BIGSAVE' },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(apply.statusCode).toBe(200);
    const body = apply.json() as { data: { discount: { code: string } | null } };
    expect(body.data.discount).not.toBeNull();
    expect(body.data.discount?.code).toBe('BIGSAVE');
  });

  it('returns 422 with reason=below_min_spend + shortfall when subtotal is too low', async () => {
    await promotionService.upsert({
      code: 'HUGEMIN',
      name: 'High minimum',
      kind: 'percentage_off',
      value: 10,
      minCartSubtotal: 100_000, // 100 000 PLN — guaranteed above any test cart
    });

    const anonToken = `anon-coupon-min-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });

    const apply = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: { code: 'HUGEMIN' },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(apply.statusCode).toBe(422);
    const body = apply.json() as {
      error: {
        code: string;
        message: string;
        details: { reason: string; shortfall?: { amount: number; currency: string } };
      };
    };
    expect(body.error.code).toBe('CART_COUPON_REJECTED');
    expect(body.error.details.reason).toBe('below_min_spend');
    expect(body.error.details.shortfall).toBeDefined();
    expect(body.error.details.shortfall?.amount).toBeGreaterThan(0);
  });

  it('clears the active coupon when code=null is submitted', async () => {
    await promotionService.upsert({
      code: 'CLEARME',
      name: 'Clear me',
      kind: 'percentage_off',
      value: 5,
    });

    const anonToken = `anon-coupon-clear-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: { code: 'CLEARME' },
      cookies: { b2b_cart_anon: anonToken },
    });

    const clear = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: { code: null },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(clear.statusCode).toBe(200);
    const body = clear.json() as { data: { discount: null | { code: string } } };
    expect(body.data.discount).toBeNull();
  });

  it('DELETE /api/v1/cart/coupon is an alias for POST {code:null}', async () => {
    await promotionService.upsert({
      code: 'ALIASTEST',
      name: 'Alias',
      kind: 'percentage_off',
      value: 5,
    });

    const anonToken = `anon-coupon-alias-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/coupon',
      payload: { code: 'ALIASTEST' },
      cookies: { b2b_cart_anon: anonToken },
    });

    const del = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/cart/coupon',
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(del.statusCode).toBe(200);
    const body = del.json() as { data: { discount: null | unknown } };
    expect(body.data.discount).toBeNull();
  });
});
