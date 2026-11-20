import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { makeMember, releaseMembers, type ReturnsFixtureMember } from '../returns/organization-fixtures.js';
import { ADMIN_COOKIE, setSellerSettings } from '../invoices/helpers.js';
import { makeOrganization, placePaidOrder } from './fixtures.js';

/**
 * `specs/182-related-payers/` FR-072, SC-003 — every out-of-scope request for a paid order
 * answers exactly as a missing order does: the payer's user without *View orders we pay for*,
 * a user of an unrelated Organization Z, and the buyer's own user on the paid-order route.
 * Compared on status, code and message (the request id differs per request by design).
 */
const MISSING = '00000000-0000-4000-8000-00000000fff1';

describe('related payers — paid orders are invisible out of scope', () => {
  let h: BackendServerHandle;
  let paid: Awaited<ReturnType<typeof placePaidOrder>>;
  let invoiceId: string;
  let viewer: ReturnsFixtureMember;
  let withoutPermission: ReturnsFixtureMember;
  let stranger: ReturnsFixtureMember;

  const shape = (res: { statusCode: number; json(): { error?: { code?: string; message?: string } } }) => ({
    status: res.statusCode,
    code: res.json().error?.code,
    message: res.json().error?.message,
  });
  const as = (cookie: string, url: string) => h.app.inject({ method: 'GET', url, cookies: { b2b_session: cookie } });

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSellerSettings(h);
    paid = await placePaidOrder(h);
    viewer = await makeMember(h.em(), paid.payerId, { permissions: ['related_payers.view_paid_orders'] }, { label: 'RP-V' });
    withoutPermission = await makeMember(h.em(), paid.payerId, 'member', { label: 'RP-NoView' });
    const z = await makeOrganization(h.em(), 'Unrelated Z');
    stranger = await makeMember(h.em(), z, 'administrator', { label: 'RP-Z' });
    const issued = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${paid.orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(issued.statusCode, issued.body).toBe(201);
    invoiceId = issued.json().data.id;
  }, 120_000);

  afterAll(async () => {
    releaseMembers();
    await teardownBackendServer(h);
  });

  it('detail and invoice PDF: identical to a missing order for every out-of-scope reader', async () => {
    const missingDetail = shape(await as(viewer.cookie, `/api/v1/account/paid-orders/${MISSING}`));
    const missingPdf = shape(await as(viewer.cookie, `/api/v1/account/paid-orders/${MISSING}/invoices/${invoiceId}/pdf`));
    expect(missingDetail.status).toBe(404);
    for (const cookie of [withoutPermission.cookie, stranger.cookie, 'stub-customer-session']) {
      expect(shape(await as(cookie, `/api/v1/account/paid-orders/${paid.orderId}`)), cookie).toEqual(missingDetail);
      expect(shape(await as(cookie, `/api/v1/account/paid-orders/${paid.orderId}/invoices/${invoiceId}/pdf`)), cookie).toEqual(
        missingPdf,
      );
    }
    // The positive control: the permitted payer user does see it.
    expect((await as(viewer.cookie, `/api/v1/account/paid-orders/${paid.orderId}`)).statusCode).toBe(200);
  });

  it('list: without the permission the list is absent; another Organization and the buyer see none of it', async () => {
    const refused = await as(withoutPermission.cookie, '/api/v1/account/paid-orders');
    expect(shape(refused)).toEqual(shape(await as(viewer.cookie, `/api/v1/account/paid-orders/${MISSING}`)));
    for (const cookie of [stranger.cookie, 'stub-customer-session']) {
      const res = await as(cookie, '/api/v1/account/paid-orders');
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.map((r: { id: string }) => r.id)).not.toContain(paid.orderId);
    }
  });
});
