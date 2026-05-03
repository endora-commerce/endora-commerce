import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { CartItem } from '../../../src/modules/carts/entities/cart-item.entity.js';

/**
 * T061 — Convert RFQ to order — integration.
 *
 * Approved RFQ → POST /convert-to-order → cart populated with one
 * line per RFQ item at the agreed unit price (SC-007). Verifies that
 * cart line `unitPrice` exactly matches the RFQ's `agreedUnitPrice`.
 */
describe('Convert RFQ to order — integration (US5)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('seeds the cart with the negotiated unit price (SC-007)', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 7, desiredUnitPrice: 12.0 },
        ],
      },
    });
    const rfq = (created.json() as { data: { id: string; version: number } }).data;

    // Admin modifies + customer accepts to get to Approved with a
    // distinct agreedUnitPrice.
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${rfq.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${rfq.version}"` },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 7, agreedUnitPrice: 11.25 }],
      },
    });
    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${rfq.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const cur = (detail.json() as { data: { currentRevisionNumber: number } }).data;
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${rfq.id}/accept-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { expectedRevisionNumber: cur.currentRevisionNumber },
    });

    const convert = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${rfq.id}/convert-to-order`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });
    expect(convert.statusCode).toBe(200);
    const { cartId } = (convert.json() as { data: { cartId: string } }).data;

    const cartItems = await h.em().find(CartItem, { cartId });
    expect(cartItems).toHaveLength(1);
    // Locked unit price flows through unchanged.
    expect(Number(cartItems[0]?.unitPrice)).toBe(11.25);
    expect(cartItems[0]?.quantity).toBe(7);
  });
});
