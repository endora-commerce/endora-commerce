import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T133 (taxes + promotions slice) — admin CRUD round-trip + preview.
 */

describe('Admin tax + promotion CRUD', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('upserts a tax and resolves it via preview', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/taxes/pl_vat_23',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'pl_vat_23',
        name: 'PL VAT 23%',
        rate: 0.23,
        country: 'PL',
        isDefault: true,
      },
    });
    expect(put.statusCode).toBe(200);

    const preview = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/taxes/preview?country=PL&productType=simple&vatStatus=vat_payer',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as { data: { rate: number; source: string } };
    expect(body.data.rate).toBe(0.23);
    expect(['rule', 'default']).toContain(body.data.source);
  });

  it('upserts a percentage_off promotion and previews it against a cart', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'WELCOME10',
        name: 'Welcome 10%',
        kind: 'percentage_off',
        value: 10,
      },
    });
    expect(create.statusCode).toBe(201);

    const preview = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions/preview',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        organizationId: '00000000-0000-4000-8000-0000000000a1',
        customerGroupId: null,
        currency: 'PLN',
        deliveryTotal: 0,
        promotionCode: 'WELCOME10',
        lines: [
          {
            productId: '00000000-0000-4000-8000-000000000001',
            variantId: null,
            categoryIds: [],
            quantity: 2,
            unitPrice: { amount: 50, currency: 'PLN' },
          },
        ],
      },
    });
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as {
      data: { discountTotal: number; total: number; appliedPromotions: unknown[] };
    };
    expect(body.data.discountTotal).toBe(10); // 100 * 10%
    expect(body.data.total).toBe(90);
    expect(body.data.appliedPromotions).toHaveLength(1);
  });

  it('rejects amount_off without currency', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/promotions',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        name: 'Bad',
        kind: 'amount_off',
        value: 5,
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
