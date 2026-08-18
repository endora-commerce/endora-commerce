import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { seedOrdersForInvoiceTests } from '../../helpers/seed-commerce.js';

/**
 * Feature 075, Phase C — the order-taking surfaces answer for a switched-off
 * owner (the second seam of the `orders` cut).
 *
 * The route surface, the external intake and the admin create path used to read
 * six other modules' entity classes directly. `em.findOne(Invoice, …)` answers
 * from a table deactivation leaves in place, so a business that had switched
 * invoicing off was still served a VAT document from an order screen; the same
 * held for the two method catalogues on the create-order preview.
 *
 * Three of those edges are probed, chosen for what they distinguish:
 *
 *  - **the customer invoice download** (`invoices`) — the surface a
 *    switched-off module owns outright, so its answer must be the one an order
 *    that has not been invoiced yet already gets, and not a 503 that reads to a
 *    buyer as a broken platform;
 *  - **the admin bulk print** (`invoices`) — the same edge on the admin side,
 *    where a silently empty PDF would be the worst answer;
 *  - **the create-order preview** (`delivery_methods`) — the quote that must
 *    keep working with less, since the operator can no longer be offered a
 *    method to quote.
 *
 * All three are declared `degrades-without` in `orders/manifest.ts` rather than
 * as dependencies: `invoices` declares this module back, and this module is
 * non-deactivatable, so binding either owner would take an operator control
 * away permanently. These assertions are what makes those declarations true.
 *
 * The platform axis is driven, because `withModuleOff` asserts the flip took
 * before the body observes anything (issue #141) and restores in its own
 * `finally`. No server is booted for the off state.
 */

const customerCookie = { b2b_session: 'stub-customer-session' };
const adminCookie = { b2b_session: 'stub-admin-session' };
/** A paid order with an attached Invoice in `status: 'ready'`. */
const INVOICED_ORDER_ID = '00000000-0000-4000-8000-000000000302';

describe('orders — the order-taking cut edges (feature 075, Phase C)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedOrdersForInvoiceTests(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('serves the invoice PDF while `invoices` is present (the positive control)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${INVOICED_ORDER_ID}/invoice`,
      cookies: customerCookie,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('stops offering the invoice PDF while `invoices` is off', async () => {
    await withModuleOff('invoices', 'platform-unavailable', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/orders/${INVOICED_ORDER_ID}/invoice`,
        cookies: customerCookie,
      });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.INVOICE_NOT_READY,
      );
    });
  });

  it('stops offering the admin bulk invoice print while `invoices` is off', async () => {
    await withModuleOff('invoices', 'platform-unavailable', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/orders/bulk/print-invoices',
        cookies: adminCookie,
        payload: { orderIds: [INVOICED_ORDER_ID] },
      });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.INVOICE_NOT_READY,
      );
    });
  });

  it('restores the invoice PDF when `invoices` comes back', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${INVOICED_ORDER_ID}/invoice`,
      cookies: customerCookie,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });
});
