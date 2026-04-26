import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedOrdersForInvoiceTests } from '../../helpers/seed-commerce.js';

/**
 * T162 — `GET /api/v1/admin/invoices` lists all invoices for the admin.
 * Filtered subsets work too; PDF download still flows through the
 * per-order existing endpoint.
 */

describe('GET /api/v1/admin/invoices', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedOrdersForInvoiceTests(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists invoices, returns the seeded ready row', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/invoices',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ id: string; status: string; pdfReady: boolean; total: number }>;
    };
    expect(Array.isArray(body.data)).toBe(true);
    // Seeded fixtures include both pending + ready invoices.
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.some((i) => i.status === 'ready' && i.pdfReady === true)).toBe(true);
  });

  it('filters by status', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/invoices?filter[status]=ready',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ status: string }> };
    body.data.forEach((row) => expect(row.status).toBe('ready'));
  });
});
