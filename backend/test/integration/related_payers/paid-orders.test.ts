import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { makeMember, releaseMembers, type ReturnsFixtureMember } from '../returns/organization-fixtures.js';
import { ADMIN_COOKIE, setSellerSettings } from '../invoices/helpers.js';
import { ADMIN, placePaidOrder } from './fixtures.js';

/**
 * `specs/182-related-payers/` US3 (FR-070, FR-071, FR-051, RP-13) — the payer's users who hold
 * *View orders we pay for* list and open the orders their Organization pays for, read-only,
 * and download their invoices there (no storefront invoice list, RP-13).
 */
describe('related payers — orders we pay for (US3)', () => {
  let h: BackendServerHandle;
  let paid: Awaited<ReturnType<typeof placePaidOrder>>;
  let viewer: ReturnsFixtureMember;
  let invoice: { id: string; number: string };

  const asViewer = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
    h.app.inject({ method, url, cookies: { b2b_session: viewer.cookie }, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSellerSettings(h);
    paid = await placePaidOrder(h);
    viewer = await makeMember(h.em(), paid.payerId, { permissions: ['related_payers.view_paid_orders'] }, { label: 'RP-Viewer' });
    const issued = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${paid.orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(issued.statusCode, issued.body).toBe(201);
    invoice = issued.json().data;
  }, 120_000);

  afterAll(async () => {
    releaseMembers();
    await teardownBackendServer(h);
  });

  it('US3-1: lists the paid order with its buyer, total and status', async () => {
    const res = await asViewer('GET', '/api/v1/account/paid-orders');
    expect(res.statusCode, res.body).toBe(200);
    const [row] = res.json().data;
    expect(row).toMatchObject({ id: paid.orderId, buyerOrganizationId: '00000000-0000-4000-8000-0000000000aa' });
    expect(res.json().pagination).toMatchObject({ hasMore: false });
  });

  it('US3-2: opens the order read-only, with its billing snapshot and invoice, and no buyer-only data', async () => {
    const res = await asViewer('GET', `/api/v1/account/paid-orders/${paid.orderId}`);
    expect(res.statusCode, res.body).toBe(200);
    const detail = res.json().data;
    expect(detail).toMatchObject({ id: paid.orderId, payer: { organizationId: paid.payerId } });
    expect(detail.invoices).toContainEqual({ id: invoice.id, number: invoice.number });
    expect(detail).not.toHaveProperty('deliveryAddress');
    expect(detail).not.toHaveProperty('customerNote');
    expect(detail).not.toHaveProperty('comments');
  });

  it('RP-13: downloads the invoice through the paid-order route', async () => {
    const res = await asViewer('GET', `/api/v1/account/paid-orders/${paid.orderId}/invoices/${invoice.id}/pdf`);
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    // An invoice id that is not this order's answers as a missing order.
    const other = await asViewer('GET', `/api/v1/account/paid-orders/${paid.orderId}/invoices/00000000-0000-4000-8000-00000000ffff/pdf`);
    expect(other.statusCode).toBe(404);
  });

  it('FR-071: the buyer-side actions on that order answer exactly as for a missing order', async () => {
    const missing = '00000000-0000-4000-8000-00000000fff2';
    const shape = (res: { statusCode: number; json(): { error?: { code?: string; message?: string } } }) => ({
      status: res.statusCode,
      code: res.json().error?.code,
      message: res.json().error?.message,
    });
    for (const [method, path, payload] of [
      ['GET', '', undefined],
      ['POST', '/cancel', {}],
      ['POST', '/reorder', {}],
      ['POST', '/comments', { body: 'hi' }],
      ['POST', '/clone-to-quote', {}],
      ['GET', '/invoice', undefined],
    ] as const) {
      const body = payload as Record<string, unknown> | undefined;
      const onPaid = await asViewer(method, `/api/v1/orders/${paid.orderId}${path}`, body);
      const onMissing = await asViewer(method, `/api/v1/orders/${missing}${path}`, body);
      expect(onPaid.statusCode, `${method} ${path}: ${onPaid.body}`).toBeGreaterThanOrEqual(400);
      expect(shape(onPaid), `${method} ${path}`).toEqual(shape(onMissing));
    }
  });

  it('FR-051: a revoked link keeps the past order listed for the payer', async () => {
    const revoked = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/related-payers/links/${paid.linkId}/revoke`,
      cookies: ADMIN,
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    const res = await asViewer('GET', '/api/v1/account/paid-orders');
    expect(res.json().data.map((r: { id: string }) => r.id)).toContain(paid.orderId);
  });
});
