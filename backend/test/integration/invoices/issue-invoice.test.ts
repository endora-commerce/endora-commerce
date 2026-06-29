import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  ADMIN_COOKIE,
  clearSellerSettings,
  seedInvoiceableOrder,
  setSellerSettings,
} from './helpers.js';

interface IssueResponse {
  data: {
    id: string;
    number: string;
    kind: string;
    status: string;
    netTotal: number;
    taxTotal: number;
    grossTotal: number;
    lines: Array<{ ordinal: number; name: string; netValue: number; grossValue: number }>;
    vatSummary: Array<{ taxRate: number; netTotal: number; vatAmount: number; grossTotal: number }>;
    seller: { taxId: string; legalName: string };
    buyer: { name: string; taxId: string };
  };
}

// A single fixed channel + a file-unique numbering prefix keeps issued numbers
// globally unique (FR-011) across the shared test DB and other invoice test files.
const CH = 'aaaaaaaa-0000-4000-8000-000000000001';

describe('invoices — issue + download (US1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSellerSettings(h);
    await h.settings.adminService.setValueForAllChannels('invoices.numbering.invoice.pattern', 'FVISS {seq}/{YYYY}', null, {
      actorAdminUserId: '00000000-0000-0000-0000-000000000000',
    });
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('issues a VAT invoice with a generated number, snapshot lines and reconciling totals', async () => {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json() as IssueResponse;
    expect(data.kind).toBe('invoice');
    expect(data.status).toBe('ready');
    expect(data.number).toMatch(/^FVISS \d+\/\d{4}$/);
    expect(data.netTotal).toBe(5405);
    expect(data.taxTotal).toBe(1243.15);
    expect(data.grossTotal).toBe(6648.15);
    expect(data.lines).toHaveLength(2);
    expect(data.seller.taxId).toBe('1234567890');
    expect(data.buyer.name).toBe('Example Buyer Sp. z o.o.');
    // per-rate reconciliation
    for (const row of data.vatSummary) {
      expect(row.netTotal + row.vatAmount).toBeCloseTo(row.grossTotal, 2);
    }
  });

  it('blocks a duplicate invoice of the same kind (409)', async () => {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const first = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(first.statusCode).toBe(201);
    const dup = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('downloads the invoice PDF (application/pdf, %PDF header)', async () => {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const issued = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    const id = (issued.json() as IssueResponse).data.id;
    const pdf = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoices/${id}/pdf`,
      cookies: ADMIN_COOKIE,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('blocks issuance with 422 when seller settings are missing', async () => {
    await clearSellerSettings(h);
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode).toBe(422);
    await setSellerSettings(h); // restore for any later tests
  });

  it('itemizes delivery and discount as lines, reconciling to the order total', async () => {
    const { orderId } = await seedInvoiceableOrder(h.em(), {
      salesChannelId: CH,
      deliveryTotal: 30,
      discountTotal: 100,
    });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json() as IssueResponse;
    const names = data.lines.map((l) => l.name);
    expect(names).toContain('Dostawa');
    expect(names).toContain('Rabat');
    expect(data.lines.find((l) => l.name === 'Rabat')?.netValue).toBe(-100);
    // products gross 6648.15 + delivery 30 - discount 100 = 6578.15 = order total
    expect(data.grossTotal).toBe(6578.15);
    // internal reconciliation still holds
    for (const row of data.vatSummary) {
      expect(row.netTotal + row.vatAmount).toBeCloseTo(row.grossTotal, 2);
    }
  });

  it('numbers increment within the same channel and year', async () => {
    const a = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const b = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const r1 = await h.app.inject({ method: 'POST', url: `/api/v1/admin/orders/${a.orderId}/invoices`, cookies: ADMIN_COOKIE, payload: { kind: 'invoice' } });
    const r2 = await h.app.inject({ method: 'POST', url: `/api/v1/admin/orders/${b.orderId}/invoices`, cookies: ADMIN_COOKIE, payload: { kind: 'invoice' } });
    const n1 = Number((r1.json() as IssueResponse).data.number.match(/FVISS (\d+)\//)?.[1]);
    const n2 = Number((r2.json() as IssueResponse).data.number.match(/FVISS (\d+)\//)?.[1]);
    expect(n2).toBe(n1 + 1);
  });
});
