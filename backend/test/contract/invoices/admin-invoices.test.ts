import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIE, seedInvoiceableOrder, setSellerSettings } from '../../integration/invoices/helpers.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';

// Feature 078, D-95: `{channel}` is rendered from the `sales_channels` row, so
// this file's channel has to be one.
let CH: string;
const CH_CODE = 'inv-contract';

interface IssueResp {
  data: { id: string; number: string; status: string };
}

describe('invoices admin API (US1 contract)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    CH = await ensureSalesChannelId(h.em(), CH_CODE);
    await setSellerSettings(h);
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.invoice.pattern',
      ['inv-contract'],
      'FVCON {seq}/{YYYY}',
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );
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
    const body = res.json() as {
      data: { lines: unknown[]; seller: { taxId: string }; orderBusinessId: string | null };
    };
    expect(body.data.lines.length).toBe(2);
    expect(body.data.seller.taxId).toBe('1234567890');
    // BUG 1 — detail must expose the order's human-readable business id.
    expect(typeof body.data.orderBusinessId).toBe('string');
    expect(body.data.orderBusinessId).toMatch(/^ORD-/);
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
