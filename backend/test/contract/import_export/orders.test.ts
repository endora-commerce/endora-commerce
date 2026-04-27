import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T240 — orders export. Import is deliberately unsupported (orders are
 * produced by the checkout flow), so the import endpoint MUST refuse with
 * 405 + a clear reason.
 */

describe('Import/Export — orders', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses import with 405 + a guidance message', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/import/orders',
      headers: { 'content-type': 'text/csv', cookie: 'b2b_session=stub-admin-session' },
      payload: 'id\n',
    });
    expect(res.statusCode).toBe(405);
    expect((res.json() as { error: { message: string } }).error.message).toContain('orders');
  });

  it('exports orders with the documented header', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/export/orders.csv',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.split('\n')[0]).toBe(
      'id,placed_at,organization_id,placed_by_customer_account_id,status,payment_status,currency,subtotal,tax_total,discount_total,delivery_total,total',
    );
  });
});
