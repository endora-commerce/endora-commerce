import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  RFQ_SHIPPED_ORDER_ID,
  RFQ_ORDER_INVOICE_PENDING_ID,
  seedShippedOrder,
  seedOrdersForInvoiceTests,
} from '../../helpers/seed-commerce.js';

/**
 * T161 — `GET /api/v1/admin/orders/:id` returns a single order with full
 * detail for the admin Orders detail page. 404 on unknown id.
 */

describe('GET /api/v1/admin/orders/:id', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedShippedOrder(h.em());
    await seedOrdersForInvoiceTests(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the order with items + totals', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${RFQ_SHIPPED_ORDER_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { id: string; status: string; items: unknown[]; total: number };
    };
    expect(body.data.id).toBe(RFQ_SHIPPED_ORDER_ID);
    expect(Array.isArray(body.data.items)).toBe(true);
    expect(body.data.total).toBeGreaterThan(0);
  });

  it('also serves the pending-invoice fixture', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${RFQ_ORDER_INVOICE_PENDING_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 404 ORDER_NOT_FOUND for a missing id', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/orders/00000000-0000-4000-8000-000000099900',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.ORDER_NOT_FOUND);
  });
});
