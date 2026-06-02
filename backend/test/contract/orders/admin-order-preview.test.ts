import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';

const SALES_CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';
const MISSING_PRODUCT_ID = '00000000-0000-4000-8000-0000000009ff';

interface PreviewBody {
  data: {
    lines: Array<{ productId: string; unitPrice: string; lineTotal: number; unavailable?: boolean }>;
    summary: {
      subtotal: number;
      taxTotal: number;
      deliveryTotal: number;
      paymentSurcharge: number;
      total: number;
      currency: string;
    };
    messages: Array<{ productId: string; code: string }>;
  };
}

/**
 * Feature 038 (US3) — the create-order form previews per-line prices and an
 * order total for the chosen customer + channel, without creating anything.
 */
describe('Admin create-order pricing preview (US3)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns per-line prices and a total summary mirroring placeOrder math', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: SALES_CHANNEL_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }],
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json() as PreviewBody;

    expect(data.lines).toHaveLength(1);
    const line = data.lines[0]!;
    expect(line.unavailable).toBeUndefined();
    expect(Number(line.unitPrice)).toBeGreaterThan(0);
    expect(line.lineTotal).toBeCloseTo(Number(line.unitPrice) * 2, 2);

    // subtotal + 23% tax + delivery + surcharge == total (placeOrder math).
    const s = data.summary;
    expect(s.subtotal).toBeCloseTo(line.lineTotal, 2);
    expect(s.taxTotal).toBeCloseTo(Math.round(s.subtotal * 0.23 * 100) / 100, 2);
    expect(s.total).toBeCloseTo(
      Math.round((s.subtotal + s.taxTotal + s.deliveryTotal + s.paymentSurcharge) * 100) / 100,
      2,
    );
    expect(s.currency).toBeTruthy();
    expect(data.messages).toHaveLength(0);
  });

  it('flags a line with no resolvable price as unavailable and excludes it from the subtotal', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders/preview',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: SALES_CHANNEL_ID,
        items: [{ productId: MISSING_PRODUCT_ID, quantity: 1 }],
      },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json() as PreviewBody;
    expect(data.lines[0]!.unavailable).toBe(true);
    expect(data.summary.subtotal).toBe(0);
    expect(data.messages.map((m) => m.productId)).toContain(MISSING_PRODUCT_ID);
  });
});
