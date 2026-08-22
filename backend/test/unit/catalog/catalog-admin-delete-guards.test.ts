import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';
import { CartItem } from '../../../src/modules/carts/entities/cart-item.entity.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

describe('Feature 032 — delete guards', () => {
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
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('blocks delete when cart_items reference the product', async () => {
    const productId = await createProduct('DEL-CART-BLOCK-001');
    // h.em() returns a fresh fork per call — use one instance, and flush the
    // cart before its item (CartItem.cartId is a scalar, so the FK insert
    // order isn't inferred).
    const em = h.em();
    const cart = em.create(Cart, {
      anonymousCartToken: `del-block-${productId.slice(0, 8)}`,
      status: 'active',
    });
    await em.flush();
    em.create(CartItem, {
      cartId: cart.id,
      productId,
      quantity: 1,
      unitPrice: '10.00',
      currency: 'PLN',
    });
    await em.flush();

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${productId}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(409);
    expect((del.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.PRODUCT_DELETE_BLOCKED,
    );
  });
});
