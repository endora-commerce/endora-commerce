import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERP_SALE_DOCUMENT_WRITE_PORT,
  type ErpSaleDocumentWritePort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIE } from '../../integration/invoices/helpers.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { Invoice, InvoiceExternalAttachment } from '../../helpers/package-entities.js';

function resolvePort(h: BackendServerHandle): ErpSaleDocumentWritePort {
  return h.container.resolve<ErpSaleDocumentWritePort>(ERP_SALE_DOCUMENT_WRITE_PORT);
}

describe('invoices — erpSaleDocumentWritePort [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('registers under the contract port name', () => {
    expect(ERP_SALE_DOCUMENT_WRITE_PORT).toBe('erpSaleDocumentWritePort');
    const port = resolvePort(h);
    expect(port).toBeDefined();
    expect(typeof port.upsertImportedDocument).toBe('function');
  });

  it('persists an ERP-imported sale document distinguishable from platform invoices', async () => {
    const port = resolvePort(h);
    const result = await port.upsertImportedDocument({
      organizationId: TEST_ORGANIZATION_ID,
      externalDocumentRef: {
        system: 'comarch_xl',
        xlSaleDocumentId: 'xl-sale-doc-contract-1',
        xlDocumentNumber: 'FV/XL/2026/1',
        documentKind: 'invoice',
      },
      kind: 'invoice',
      number: 'FV/XL/2026/1',
      currency: 'PLN',
      issuedAt: '2026-09-14T10:00:00.000Z',
      grossTotal: '1230.00',
      attachments: [
        {
          xlAttachmentId: 'att-1',
          fileName: 'invoice.pdf',
          contentType: 'application/pdf',
        },
      ],
    });

    expect(result.created).toBe(true);
    const row = await h.em().findOneOrFail(Invoice, { id: result.invoiceId });
    expect(row.origin).toBe('erp_import');
    expect(row.organizationId).toBe(TEST_ORGANIZATION_ID);
    expect(row.externalDocumentRef?.xlSaleDocumentId).toBe('xl-sale-doc-contract-1');
    expect(row.orderId ?? null).toBeNull();

    const attachments = await h.em().find(InvoiceExternalAttachment, { invoiceId: row.id });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.xlAttachmentId).toBe('att-1');
  });

  it('is idempotent on xlSaleDocumentId', async () => {
    const port = resolvePort(h);
    const input = {
      organizationId: TEST_ORGANIZATION_ID,
      externalDocumentRef: {
        system: 'comarch_xl' as const,
        xlSaleDocumentId: 'xl-sale-doc-contract-idempotent',
        xlDocumentNumber: 'FV/XL/2026/2',
        documentKind: 'invoice' as const,
      },
      kind: 'invoice' as const,
      number: 'FV/XL/2026/2',
      currency: 'PLN',
      issuedAt: '2026-09-14T11:00:00.000Z',
      grossTotal: '500.00',
    };

    const first = await port.upsertImportedDocument(input);
    const second = await port.upsertImportedDocument({
      ...input,
      grossTotal: '600.00',
      paidTotal: '600.00',
    });

    expect(second.created).toBe(false);
    expect(second.invoiceId).toBe(first.invoiceId);
    const row = await h.em().findOneOrFail(Invoice, { id: first.invoiceId });
    expect(row.total).toBe('600.00');
    expect(row.paidTotal).toBe('600.00');
  });
});

describe('invoices — organization sale-document customer routes [contract]', () => {
  let h: BackendServerHandle;
  let invoiceId: string;
  let attachmentId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const port = resolvePort(h);
    const result = await port.upsertImportedDocument({
      organizationId: TEST_ORGANIZATION_ID,
      externalDocumentRef: {
        system: 'comarch_xl',
        xlSaleDocumentId: 'xl-sale-doc-customer-list',
        xlDocumentNumber: 'WZ/XL/2026/1',
        documentKind: 'wz',
      },
      kind: 'wz',
      number: 'WZ/XL/2026/1',
      currency: 'PLN',
      issuedAt: '2026-09-14T12:00:00.000Z',
      grossTotal: '100.00',
      attachments: [
        {
          xlAttachmentId: 'att-customer',
          fileName: 'delivery-note.pdf',
          contentType: 'application/pdf',
        },
      ],
    });
    invoiceId = result.invoiceId;
    const attachment = await h.em().findOneOrFail(InvoiceExternalAttachment, { invoiceId });
    attachmentId = attachment.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists ERP-imported documents for the signed-in organization', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/account/organization/invoices',
      cookies: CUSTOMER_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ id: string; documentKind: string; attachments: Array<{ id: string }> }>;
    };
    expect(body.data.some((row) => row.id === invoiceId)).toBe(true);
    const row = body.data.find((entry) => entry.id === invoiceId);
    expect(row?.documentKind).toBe('wz');
    expect(row?.attachments.some((entry) => entry.id === attachmentId)).toBe(true);
  });

  it('refuses attachment download before bytes are stored', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/account/organization/invoices/${invoiceId}/attachments/${attachmentId}`,
      cookies: CUSTOMER_COOKIE,
    });
    expect(res.statusCode).toBe(404);
  });
});
