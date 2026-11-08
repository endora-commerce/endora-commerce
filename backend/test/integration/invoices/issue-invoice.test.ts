import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
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
// Feature 078, D-95: `{channel}` is rendered from the `sales_channels`
// row, so this file's channel has to be one. The per-file code keeps this
// file's numbers distinct in the shared test database, which is what the
// fabricated id used to be for.
let CH: string;

describe('invoices — issue + download (US1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    CH = await ensureSalesChannelId(h.em(), 'inv-issue');
    await setSellerSettings(h);
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.invoice.pattern',
      ['inv-issue'],
      'FVISS {seq}/{YYYY}',
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );
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

  it('writes each new line\'s kind, the 0 % delivery and surcharge lines included (#904 Phase A)', async () => {
    const { orderId, itemIds } = await seedInvoiceableOrder(h.em(), {
      salesChannelId: CH,
      deliveryTotal: 30,
      discountTotal: 100,
    });
    // The seeder carries no surcharge: the payment method's snapshot names one.
    await h.em().getConnection().execute(
      `update "orders" set "payment_method_snapshot" = "payment_method_snapshot" || '{"additionalPrice": 2.5}'::jsonb,
         "total" = "total" + 2.50 where "id" = ?`,
      [orderId],
    );
    for (const kind of ['proforma', 'invoice'] as const) {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${orderId}/invoices`,
        cookies: ADMIN_COOKIE,
        payload: { kind },
      });
      expect(res.statusCode, res.body).toBe(201);
      const { data } = res.json() as IssueResponse;
      const rows = await h.em().getConnection().execute<
        Array<{ line_kind: string | null; tax_rate: string; net_value: string; order_item_id: string | null }>
      >(
        `select "line_kind", "tax_rate", "net_value", "order_item_id" from "invoice_lines" where "invoice_id" = ? order by "ordinal"`,
        [data.id],
      );
      // The two goods lines were seeded in one flush, so their order is not the point.
      expect(rows.slice(0, 2)).toHaveLength(2);
      expect(rows.slice(0, 2)).toEqual(
        expect.arrayContaining([
          { line_kind: 'goods', tax_rate: '0.2300', net_value: '900.00', order_item_id: itemIds[0] },
          { line_kind: 'goods', tax_rate: '0.2300', net_value: '4505.00', order_item_id: itemIds[1] },
        ]),
      );
      expect(rows.slice(2)).toEqual([
        // Phase A changes no amount: the charges stay 0 % lines, now named.
        { line_kind: 'delivery', tax_rate: '0.0000', net_value: '30.00', order_item_id: null },
        { line_kind: 'payment_surcharge', tax_rate: '0.0000', net_value: '2.50', order_item_id: null },
        { line_kind: 'discount', tax_rate: '0.0000', net_value: '-100.00', order_item_id: null },
      ]);
      expect(data.grossTotal).toBe(6580.65);
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
