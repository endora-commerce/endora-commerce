import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 045 / US1 — the cart read path surfaces the real discount amount
 * and the per-promotion breakdown for an automatic action-based promotion.
 */
describe('cart promotion display', () => {
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

  it('shows discount amount + appliedPromotions for an automatic 10% promotion', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: adminCookie,
      payload: {
        name: 'auto 10% off',
        action: { type: 'percentage_off_cart', percent: 10 },
        rule: { kind: 'condition', field: { kind: 'builtin', key: 'cartTotal' }, op: 'gte', values: [1] },
      },
    });
    expect(create.statusCode).toBe(201);

    const anonToken = `anon-promo-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 2 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add.statusCode).toBe(200);

    const get = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(get.statusCode).toBe(200);
    const body = get.json() as {
      data: {
        subtotal: { amount: number };
        discount: { amount: number } | null;
        appliedPromotions: Array<{ promotionId: string; amount: number }>;
        grandTotal: { amount: number };
      };
    };
    const subtotal = body.data.subtotal.amount;
    expect(subtotal).toBeGreaterThan(0);
    const expected = Math.round(subtotal * 0.1 * 100) / 100;
    expect(body.data.discount?.amount).toBe(expected);
    expect(body.data.appliedPromotions).toHaveLength(1);
    expect(body.data.appliedPromotions[0]!.amount).toBe(expected);
    expect(body.data.grandTotal.amount).toBe(Math.round((subtotal - expected) * 100) / 100);
  });
});
