import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIE, seedInvoiceableOrder, setSellerSettings } from '../../integration/invoices/helpers.js';

const CH = 'aaaaaaaa-0000-4000-8000-0000000000c0';

interface IssueResp {
  data: { id: string; number: string; status: string };
}

describe('invoices admin API (US1 contract)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSellerSettings(h);
    await h.settings.adminService.setValueForAllChannels('invoices.numbering.invoice.pattern', 'FVCON {seq}/{YYYY}', null, {
      actorAdminUserId: '00000000-0000-0000-0000-000000000000',
    });
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function issue(): Promise<string> {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    return (res.json() as IssueResp).data.id;
  }

  it('requires auth (401/403 without admin cookie)', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/invoices' });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('lists invoices with orderBusinessId and pdfReady', async () => {
    await issue();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/invoices', cookies: ADMIN_COOKIE });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ number: string; pdfReady: boolean }> };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0]?.pdfReady).toBe(true);
  });

  it('returns invoice detail with lines and seller/buyer', async () => {
    const id = await issue();
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/invoices/${id}`, cookies: ADMIN_COOKIE });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { lines: unknown[]; seller: { taxId: string } } };
    expect(body.data.lines.length).toBe(2);
    expect(body.data.seller.taxId).toBe('1234567890');
  });

  it('regenerate-pdf returns the detail (200)', async () => {
    const id = await issue();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${id}/regenerate-pdf`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
  });

  it('filters the list by kind', async () => {
    await issue();
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/invoices?filter[kind]=invoice',
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ kind: string }> };
    expect(body.data.every((i) => i.kind === 'invoice')).toBe(true);
  });
});
