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
import { Order } from '../../helpers/package-entities.js';

/**
 * Feature 055 US3 (T036) — custom-field values on an org-owned host (Order) are
 * confined to the host record's tenant scope (SC-004). Because the value bag is
 * a column on an `@OrgScoped` entity, the feature-050 framework guard filters it
 * for free: a customer of Org A can never see Org B's order — nor its custom
 * fields — and an out-of-scope order-by-id is indistinguishable from not-found.
 */
describe('Custom Fields — cross-tenant isolation on an org-scoped host [real DB]', () => {
  let h: BackendServerHandle;
  const orgBId = randomUUID();
  const customerBId = randomUUID();
  const customerBCookie = `stub-customer-cf-${Date.now()}`;
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
      // Stamp distinct custom-field bags on each order.
      const em = h.em();
      const oa = await em.findOneOrFail(Order, { id: orderAId });
      oa.customFieldValues = { secret_ref: 'ORG-A-ONLY' };
      const ob = await em.findOneOrFail(Order, { id: orderBId });
      ob.customFieldValues = { secret_ref: 'ORG-B-ONLY' };
      await em.flush();
    });
  });

  afterAll(async () => {
    delete CUSTOMER_COOKIES[customerBCookie];
    await teardownBackendServer(h);
  });

  it('customer A sees only their own order custom fields (SC-004)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { data: Array<{ id: string; customFieldValues?: Record<string, unknown> }> }).data;
    const a = rows.find((o) => o.id === orderAId);
    expect(a?.customFieldValues).toMatchObject({ secret_ref: 'ORG-A-ONLY' });
    // Org B's order — and thus its custom-field bag — never appears.
    expect(rows.some((o) => o.id === orderBId)).toBe(false);
    const leaked = JSON.stringify(rows).includes('ORG-B-ONLY');
    expect(leaked).toBe(false);
  });

  it("Org B's order-by-id is indistinguishable from not-found for customer A (SC-004)", async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderBId}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body.includes('ORG-B-ONLY')).toBe(false);
  });
});
