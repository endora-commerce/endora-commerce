import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { OrderItem } from '../../../src/modules/orders/entities/order-item.entity.js';
import {
  seedUs2Commerce,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

describe('Feature 032 — DELETE /admin/catalog/products/:id', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(sku: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku,
        type: 'simple',
        name: { 'en-US': sku },
        description: { 'en-US': 'desc' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('soft-deletes a deletable product with 204', async () => {
    const id = await createProduct('DEL-OK-001');
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);

    const rows = (await h.em().getConnection().execute<Array<{ deleted_at: Date | null }>>(
      `select deleted_at from products where id = ?`,
      [id],
    )) as Array<{ deleted_at: Date | null }>;
    expect(rows[0]?.deleted_at).not.toBeNull();

    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: adminCookie,
    });
    expect(get.statusCode).toBe(404);
  });

  it('returns PRODUCT_DELETE_BLOCKED when order_items reference the product', async () => {
    await seedUs2Commerce(h.em());
    const id = await createProduct('DEL-BLOCK-001');
    const order = h.em().create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: '00000000-0000-4000-8000-0000000000c1',
      status: 'new',
      paymentStatus: 'awaiting_payment',
      deliveryAddress: {
        recipientName: 'Stub',
        street: 'ul. Test 1',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
      },
      billingAddress: {
        recipientName: 'Stub',
        street: 'ul. Test 2',
        city: 'Warszawa',
        postalCode: '00-101',
        country: 'PL',
      },
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      deliveryMethodSnapshot: { code: 'pickup', name: 'Pickup', cost: 0 },
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
      paymentMethodSnapshot: { code: 'bank_transfer', name: 'BT', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '10.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    h.em().create(OrderItem, {
      orderId: order.id,
      productId: id,
      productSnapshot: { sku: 'DEL-BLOCK-001', name: 'Blocked', primaryAssetUrl: null },
      quantity: 1,
      unitPrice: '10.00',
      taxRate: '0.23',
      lineTotal: '10.00',
    });
    await h.em().flush();

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(409);
    const body = del.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.PRODUCT_DELETE_BLOCKED);
  });

  it('returns 404 when deleting an already deleted product', async () => {
    const id = await createProduct('DEL-404-001');
    await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: adminCookie,
    });
    const again = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: adminCookie,
    });
    expect(again.statusCode).toBe(404);
  });
});
