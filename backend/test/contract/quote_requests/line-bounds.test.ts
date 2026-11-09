import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { LINE_QUANTITY_MAX, REQUEST_LINE_ITEMS_MAX, expectBoundRefused } from '../../helpers/line-bounds.js';

/**
 * Issue #351 — the quote request create and edit routes, the customer's and the
 * operator's, bound a line's quantity at `LINE_QUANTITY_MAX` and the line array
 * at `REQUEST_LINE_ITEMS_MAX`. One past either bound is `400 VALIDATION_FAILED`
 * naming the field; the bound itself is accepted.
 */
describe('quote requests — line bounds (issue #351)', () => {
  let h: BackendServerHandle;
  const CUSTOMER = { b2b_session: 'stub-customer-session' };
  const ADMIN = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const lines = (n: number, quantity = 1) => Array.from({ length: n }, () => ({ productId: SEED_PRODUCT_101_ID, quantity }));
  const adminLines = (n: number, quantity = 1) => lines(n, quantity).map((l) => ({ ...l, agreedUnitPrice: 5 }));

  const customerCreate = (items: unknown[]) =>
    h.app.inject({ method: 'POST', url: '/api/v1/quote-requests', cookies: CUSTOMER, payload: { items } });
  const customerPatch = (id: string, items: unknown[]) =>
    h.app.inject({ method: 'PATCH', url: `/api/v1/quote-requests/${id}`, cookies: CUSTOMER, payload: { items } });
  const adminCreate = (items: unknown[]) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: { organizationId: TEST_ORGANIZATION_ID, customerAccountId: TEST_CUSTOMER_ID, items },
    });
  const adminPatch = (id: string, version: number, items: unknown[]) =>
    h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: ADMIN,
      headers: { 'if-match': `"${version}"` },
      payload: { items },
    });

  async function pending(): Promise<{ id: string; version: number }> {
    const res = await customerCreate(lines(1));
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  describe('POST /api/v1/quote-requests', () => {
    it('refuses a quantity one past the bound', async () => {
      expectBoundRefused(await customerCreate(lines(1, LINE_QUANTITY_MAX + 1)), 'items.0.quantity');
    });
    it('accepts a quantity at the bound', async () => {
      const res = await customerCreate(lines(1, LINE_QUANTITY_MAX));
      expect(res.statusCode, res.body).toBe(201);
    });
    it('refuses one line past the line bound and accepts the bound', async () => {
      expectBoundRefused(await customerCreate(lines(REQUEST_LINE_ITEMS_MAX + 1)), 'items');
      expect((await customerCreate(lines(REQUEST_LINE_ITEMS_MAX))).statusCode).toBe(201);
    });
  });

  describe('PATCH /api/v1/quote-requests/:id (draft edit)', () => {
    it('refuses a quantity one past the bound and accepts the bound', async () => {
      const { id } = await pending();
      expectBoundRefused(await customerPatch(id, lines(1, LINE_QUANTITY_MAX + 1)), 'items.0.quantity');
      const res = await customerPatch(id, lines(1, LINE_QUANTITY_MAX));
      expect(res.statusCode, res.body).toBe(200);
    });
    it('refuses one line past the line bound and accepts the bound', async () => {
      const { id } = await pending();
      expectBoundRefused(await customerPatch(id, lines(REQUEST_LINE_ITEMS_MAX + 1)), 'items');
      const res = await customerPatch(id, lines(REQUEST_LINE_ITEMS_MAX));
      expect(res.statusCode, res.body).toBe(200);
    });
  });

  describe('POST /api/v1/admin/quote-requests', () => {
    it('refuses a quantity one past the bound and accepts the bound', async () => {
      expectBoundRefused(await adminCreate(adminLines(1, LINE_QUANTITY_MAX + 1)), 'items.0.quantity');
      const res = await adminCreate(adminLines(1, LINE_QUANTITY_MAX));
      expect(res.statusCode, res.body).toBe(201);
    });
    it('refuses one line past the line bound and accepts the bound', async () => {
      expectBoundRefused(await adminCreate(adminLines(REQUEST_LINE_ITEMS_MAX + 1)), 'items');
      const res = await adminCreate(adminLines(REQUEST_LINE_ITEMS_MAX));
      expect(res.statusCode, res.body).toBe(201);
    });
  });

  describe('PATCH /api/v1/admin/quote-requests/:id', () => {
    it('refuses a quantity one past the bound and accepts the bound', async () => {
      const { id, version } = await pending();
      expectBoundRefused(await adminPatch(id, version, adminLines(1, LINE_QUANTITY_MAX + 1)), 'items.0.quantity');
      const res = await adminPatch(id, version, adminLines(1, LINE_QUANTITY_MAX));
      expect(res.statusCode, res.body).toBe(200);
    });
    it('refuses one line past the line bound and accepts the bound', async () => {
      const { id, version } = await pending();
      expectBoundRefused(await adminPatch(id, version, adminLines(REQUEST_LINE_ITEMS_MAX + 1)), 'items');
      const res = await adminPatch(id, version, adminLines(REQUEST_LINE_ITEMS_MAX));
      expect(res.statusCode, res.body).toBe(200);
    });
  });
});
