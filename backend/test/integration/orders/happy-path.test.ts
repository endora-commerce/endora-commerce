import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T103 — Integration: register → verify → add address → cart → checkout →
 * order visible in admin list. Covers SC-005 "a new Customer can register and
 * place an order within a single session, using a single, well-documented
 * payment method".
 */

interface Order { id: string; status: string }

describe('orders happy path — register to admin visibility', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('registers an Organization, places a bank-transfer Order, admin sees it', async () => {
    // 1. Register + verify (test helper probe)
    const register = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: {
        organization: {
          name: 'HappyPath Sp. z o.o.',
          taxId: 'PL0000000001',
          registeredAddress: {
            street: 'ul. Happy 1',
            city: 'Warszawa',
            postalCode: '00-999',
            country: 'PL',
          },
        },
        firstUser: {
          email: 'happy@example.com',
          password: 'strong-password-1234!',
          firstName: 'Happy',
          lastName: 'Customer',
        },
        acceptedTermsVersion: '1.0.0',
      },
    });
    expect(register.statusCode).toBe(201);

    const tokenProbe = await h.app.inject({
      method: 'GET',
      url: '/api/v1/_test/latest-verification-token',
    });
    expect(tokenProbe.statusCode).toBe(200);
    const { token } = tokenProbe.json() as { token: string };

    const verify = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/email-verification/verify',
      payload: { token },
    });
    expect(verify.statusCode).toBe(200);

    // 2. Log in — sets b2b_session cookie.
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: 'happy@example.com', password: 'strong-password-1234!' },
    });
    expect(login.statusCode).toBe(200);
    const sessionCookie = parseSessionCookie(login.headers['set-cookie']);

    // 3. Add address.
    const address = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/addresses',
      payload: {
        kind: 'delivery',
        recipientName: 'Happy Customer',
        street: 'ul. Odbioru 3',
        city: 'Warszawa',
        postalCode: '00-100',
        country: 'PL',
        isDefault: true,
      },
      cookies: { b2b_session: sessionCookie },
    });
    expect(address.statusCode).toBe(201);

    // 4. Add item to cart.
    const addCart = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_session: sessionCookie },
    });
    expect(addCart.statusCode).toBe(200);

    // 5. Place order.
    const place = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: (address.json() as { data: { id: string } }).data.id,
        billingAddressId: (address.json() as { data: { id: string } }).data.id,
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: '00000000-0000-4000-8000-0000000000f1',
      },
      cookies: { b2b_session: sessionCookie },
    });
    expect(place.statusCode).toBe(201);
    const order = (place.json() as { data: Order }).data;

    // 6. Admin sees it.
    const adminList = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/orders',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(adminList.statusCode).toBe(200);
    const body = adminList.json() as { data: Order[] };
    expect(body.data.some((o) => o.id === order.id)).toBe(true);
  });
});

function parseSessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie.find((c) => c.includes('b2b_session=')) : setCookie;
  if (!header) return '';
  const match = /b2b_session=([^;]+)/.exec(header);
  return match?.[1] ?? '';
}
