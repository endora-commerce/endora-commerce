import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERP_SALE_DOCUMENT_WRITE_PORT,
  adminInvoiceListResponseSchema,
  erpSaleDocumentListResponseSchema,
  orderInvoiceListResponseSchema,
  type ErpSaleDocumentWritePort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  ADMIN_COOKIE,
  CUSTOMER_COOKIE,
  seedInvoiceableOrder,
  setSellerSettings,
} from '../../integration/invoices/helpers.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';

/**
 * The invoice **list** routes answer what `@endora-commerce/contracts`
 * publishes, and nothing beside it (Constitution II, issue #599 §2 — the routes
 * #128's survey did not reach).
 *
 * Each reply is driven through the real HTTP stack and parsed with a **strict
 * copy** of its published schema (`test/helpers/strict-schema.ts`): a declared
 * field answered with a type the schema refuses, a required field not answered
 * and a key no schema declares all red this file. The lists hold a platform
 * invoice issued against an order **and** an ERP-imported sale document with
 * no order — the row whose `orderId` is `null`.
 */
describe('invoice list responses parse with the published invoice list schemas', () => {
  let h: BackendServerHandle;
  let orderId: string;
  let invoiceId: string;
  let importedId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const channelId = await ensureSalesChannelId(h.em(), 'inv-list-schema');
    await setSellerSettings(h);
    ({ orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: channelId }));
    const issued = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(issued.statusCode, issued.body).toBe(201);
    invoiceId = (issued.json() as { data: { id: string } }).data.id;

    const imported = await h.container
      .resolve<ErpSaleDocumentWritePort>(ERP_SALE_DOCUMENT_WRITE_PORT)
      .upsertImportedDocument({
        organizationId: TEST_ORGANIZATION_ID,
        externalDocumentRef: {
          system: 'comarch_xl',
          externalId: `xl-599-${Date.now()}`,
          externalNumber: 'FV/XL/599',
          documentKind: 'invoice',
        },
        kind: 'invoice',
        number: `FV/XL/599/${Date.now()}`,
        currency: 'PLN',
        issuedAt: '2026-11-01T10:00:00.000Z',
        grossTotal: '123.00',
        attachments: [{ externalAttachmentId: 'att-599', fileName: 'invoice.pdf', contentType: null }],
      });
    importedId = imported.invoiceId;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function body(url: string, cookies: Record<string, string>): Promise<{ data: Array<{ id: string }> }> {
    const res = await h.app.inject({ method: 'GET', url, cookies });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { data: Array<{ id: string }> };
  }

  it('GET /api/v1/admin/invoices — a platform invoice and an ERP document without an order', async () => {
    const reply = await body('/api/v1/admin/invoices?limit=200', ADMIN_COOKIE);
    expect(reply.data.map((row) => row.id)).toEqual(expect.arrayContaining([invoiceId, importedId]));
    expect(disagreements(deepStrict(adminInvoiceListResponseSchema), reply)).toEqual([]);
  });

  it('GET /api/v1/admin/invoices — an order-number filter that matches nothing', async () => {
    const reply = await body('/api/v1/admin/invoices?filter[orderNumber]=no-such-order-599', ADMIN_COOKIE);
    expect(reply.data).toEqual([]);
    expect(disagreements(deepStrict(adminInvoiceListResponseSchema), reply)).toEqual([]);
  });

  it('GET /api/v1/orders/:id/invoices — the buyer list of one order', async () => {
    const reply = await body(`/api/v1/orders/${orderId}/invoices`, CUSTOMER_COOKIE);
    expect(reply.data.map((row) => row.id)).toContain(invoiceId);
    expect(disagreements(deepStrict(orderInvoiceListResponseSchema), reply)).toEqual([]);
  });

  it('GET /api/v1/account/organization/invoices — the ERP sale documents', async () => {
    const reply = await body('/api/v1/account/organization/invoices', CUSTOMER_COOKIE);
    expect(reply.data.map((row) => row.id)).toContain(importedId);
    expect(disagreements(deepStrict(erpSaleDocumentListResponseSchema), reply)).toEqual([]);
  });
});
