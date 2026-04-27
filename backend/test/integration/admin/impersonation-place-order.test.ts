import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';
import { seedCartForStubCustomer } from '../../helpers/seed-commerce.js';

/**
 * T183 — During Impersonation, `POST /orders` placed by the impersonating
 * Admin User on behalf of a Customer MUST set
 * Order.placedOnBehalfByAdminUserId and write an AuditLogEntry with the
 * Admin User as actor (action='order.place_on_behalf').
 */

interface PlacedOrder { id: string; placedOnBehalfByAdminUserId: string | null }

function parseCookies(setCookie: string | string[] | undefined): {
  b2b_session?: string;
  admin_shadow_session?: string;
} {
  const headers = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  const jar: { b2b_session?: string; admin_shadow_session?: string } = {};
  for (const h of headers) {
    const m1 = /b2b_session=([^;]+)/.exec(h);
    const m2 = /admin_shadow_session=([^;]+)/.exec(h);
    if (m1?.[1]) jar.b2b_session = m1[1];
    if (m2?.[1]) jar.admin_shadow_session = m2[1];
  }
  return jar;
}

describe('Impersonated place-order tagging', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('places the order with placedOnBehalfByAdminUserId set + audit entry', async () => {
    // 1. Admin starts impersonation of TEST_CUSTOMER (the org admin).
    const customerId = '00000000-0000-4000-8000-0000000000a1';
    const orgId = '00000000-0000-4000-8000-0000000000aa';

    const start = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/impersonate`,
      payload: { customerAccountId: customerId },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(start.statusCode).toBe(200);
    const cookies = parseCookies(start.headers['set-cookie']);

    // 2. Place an order using the impersonation cookie.
    const place = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: '00000000-0000-4000-8000-0000000000f1',
      },
      cookies: { b2b_session: cookies.b2b_session ?? '' },
    });
    expect(place.statusCode).toBe(201);
    const order = (place.json() as { data: PlacedOrder }).data;
    expect(order.placedOnBehalfByAdminUserId).toBe('00000000-0000-4000-8000-0000000000b1');

    const entry = await h.em().findOne(
      AuditLogEntry,
      { action: 'order.place_on_behalf', objectId: order.id },
      { orderBy: { actedAt: 'desc' } },
    );
    expect(entry).not.toBeNull();
    expect(entry!.actorAdminUserId).toBe('00000000-0000-4000-8000-0000000000b1');
    expect(entry!.impersonatedCustomerAccountId).toBe(customerId);
  });
});
