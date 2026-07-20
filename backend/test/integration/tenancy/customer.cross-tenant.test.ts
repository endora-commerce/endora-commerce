import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { seedInvoiceableOrder } from '../invoices/helpers.js';

/**
 * Feature 050 US2 — customer isolation is enforced by the guard. A customer of
 * Org A sees only their own organization's orders; another org's order is
 * invisible, sourced from the session and not from any request-supplied org id.
 */
describe('Customer isolation — cross-tenant scoping (feature 050 US2)', () => {
  let h: BackendServerHandle;
  const orgBId = randomUUID();
  const customerBId = randomUUID();
  const customerBCookie = `stub-customer-050-${Date.now()}`;
  let orderAId: string;
  let orderBId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    CUSTOMER_COOKIES[customerBCookie] = { customerAccountId: customerBId, organizationId: orgBId };

    await withSystemScope('test seed', async () => {
      const a = await seedInvoiceableOrder(h.em(), {
        organizationId: TEST_ORGANIZATION_ID,
        placedByCustomerAccountId: TEST_CUSTOMER_ID,
      });
      const b = await seedInvoiceableOrder(h.em(), {
        organizationId: orgBId,
        placedByCustomerAccountId: customerBId,
      });
      orderAId = a.orderId;
      orderBId = b.orderId;
    });
  });

  afterAll(async () => {
    delete CUSTOMER_COOKIES[customerBCookie];
    await teardownBackendServer(h);
  });

  it('customer A sees their own org order, not another org order (T025)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((o) => o.id);
    expect(ids).toContain(orderAId);
    expect(ids).not.toContain(orderBId);
  });

  it('customer B sees only their own org order (T025, symmetric)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      cookies: { b2b_session: customerBCookie },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((o) => o.id);
    expect(ids).toContain(orderBId);
    expect(ids).not.toContain(orderAId);
  });

  it('a request-supplied organizationId is ignored — the session is authoritative (T026)', async () => {
    // Customer A tries to widen to Org B via a query param; the guard uses the
    // session org, so Org B's order stays invisible.
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders?organizationId=${orgBId}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((o) => o.id);
    expect(ids).not.toContain(orderBId);
  });
});
