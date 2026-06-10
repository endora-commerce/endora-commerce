import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Feature 043 (US3) — converting a cart that contains a packaging-unit line to
 * a Quote Request carries the unit name into the RFQ line (appended to the
 * product name).
 */
describe('Cart → RFQ packaging snapshot (043)', () => {
  let h: BackendServerHandle;
  const customer = { b2b_session: 'stub-customer-session' };
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('appends the packaging-unit name to the RFQ line name', async () => {
    // Define a packaging unit on a seeded product.
    const unitRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${SEED_PRODUCT_101_ID}/packaging-units`,
      payload: { name: 'PaletaRfq', baseQuantity: 100, isDefault: true },
      cookies: admin,
    });
    expect(unitRes.statusCode).toBe(201);
    const unitId = (unitRes.json() as { data: { id: string } }).data.id;

    // Add it to the customer's cart as a packaging unit.
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: customer,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 2, packagingUnitId: unitId },
    });
    expect(add.statusCode).toBe(200);

    // Convert the cart to a quote request.
    const convert = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/convert-to-quote-request',
      cookies: customer,
      payload: {},
    });
    expect(convert.statusCode).toBe(200);
    const rfqId = (convert.json() as { data: { quoteRequestId?: string; id?: string } }).data;
    const id = rfqId.quoteRequestId ?? rfqId.id;
    expect(id).toBeTruthy();

    // The RFQ line shows "<name> (PaletaRfq)" with the resulting quantity.
    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${id}`,
      cookies: customer,
    });
    expect(detail.statusCode).toBe(200);
    const items = (detail.json() as { data: { items: Array<{ productName: string; quantity: number }> } }).data.items;
    const line = items.find((i) => /\(PaletaRfq\)$/.test(i.productName));
    expect(line).toBeDefined();
    expect(line?.quantity).toBe(200); // 100 × 2
  });
});
