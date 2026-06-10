import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Feature 043 (US3) — placing an order from a cart that contains a
 * packaging-unit line records the unit on the order line: the unit name is
 * appended to `product_snapshot.name` and a structured `packaging_unit_snapshot`
 * is stored. Mirrors the orders happy-path flow.
 */
describe('Cart → Order packaging snapshot (043)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('appends the packaging-unit name to the order line snapshot', async () => {
    const email = `pkg-order-${Date.now()}@example.com`;
    const register = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: {
        organization: {
          name: 'PkgOrder Sp. z o.o.',
          taxId: `PL${String(Date.now()).slice(-10)}`,
          registeredAddress: { street: 'ul. Pkg 1', city: 'Warszawa', postalCode: '00-999', country: 'PL' },
        },
        firstUser: { email, password: 'strong-password-1234!', firstName: 'Pkg', lastName: 'Buyer' },
        acceptedTermsVersion: '1.0.0',
      },
    });
    expect(register.statusCode).toBe(201);

    const { token } = (await h.app.inject({ method: 'GET', url: '/api/v1/_test/latest-verification-token' })).json() as { token: string };
    await h.app.inject({ method: 'POST', url: '/api/v1/auth/email-verification/verify', payload: { token } });

    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email, password: 'strong-password-1234!' },
    });
    const session = parseSessionCookie(login.headers['set-cookie']);

    const address = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/addresses',
      payload: { kind: 'delivery', recipientName: 'Pkg Buyer', street: 'ul. Odbioru 3', city: 'Warszawa', postalCode: '00-100', country: 'PL', isDefault: true },
      cookies: { b2b_session: session },
    });
    const addressId = (address.json() as { data: { id: string } }).data.id;

    // Define a packaging unit on the seeded product.
    const unit = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${SEED_PRODUCT_101_ID}/packaging-units`,
      payload: { name: 'PaletaOrder', baseQuantity: 2, isDefault: true },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(unit.statusCode).toBe(201);
    const unitId = (unit.json() as { data: { id: string } }).data.id;

    // Add it to the cart and place the order.
    const addCart = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1, packagingUnitId: unitId },
      cookies: { b2b_session: session },
    });
    expect(addCart.statusCode).toBe(200);

    const place = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: addressId,
        billingAddressId: addressId,
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: '00000000-0000-4000-8000-0000000000f1',
      },
      cookies: { b2b_session: session },
    });
    expect(place.statusCode).toBe(201);
    const orderId = (place.json() as { data: { id: string } }).data.id;

    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orderId}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(detail.statusCode).toBe(200);
    const items = (detail.json() as { data: { items: Array<{ productSnapshot: { name: string }; quantity: number }> } }).data.items;
    const line = items.find((i) => /\(PaletaOrder\)$/.test(i.productSnapshot.name));
    expect(line).toBeDefined();
    expect(line?.quantity).toBe(2); // 2 × 1
  });
});

function parseSessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie.find((c) => c.includes('b2b_session=')) : setCookie;
  if (!header) return '';
  const match = /b2b_session=([^;]+)/.exec(header);
  return match?.[1] ?? '';
}
