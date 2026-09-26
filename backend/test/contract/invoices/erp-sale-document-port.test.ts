import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERP_SALE_DOCUMENT_WRITE_PORT,
  ERROR_CODES,
  INVOICE_ATTACHMENT_FETCH_REGISTRY,
  type ErpSaleDocumentUpsertInput,
  type ErpSaleDocumentWritePort,
  type InvoiceAttachmentFetchRegistryPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIE } from '../../integration/invoices/helpers.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  Invoice,
  InvoiceExternalAttachment,
  type InvoiceRow,
} from '../../helpers/package-entities.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';

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
        externalId: 'xl-sale-doc-contract-1',
        externalNumber: 'FV/XL/2026/1',
        documentKind: 'invoice',
      },
      kind: 'invoice',
      number: 'FV/XL/2026/1',
      currency: 'PLN',
      issuedAt: '2026-09-14T10:00:00.000Z',
      grossTotal: '1230.00',
      attachments: [
        {
          externalAttachmentId: 'att-1',
          fileName: 'invoice.pdf',
          contentType: 'application/pdf',
        },
      ],
    });

    expect(result.created).toBe(true);
    const row = await h.em().findOneOrFail(Invoice, { id: result.invoiceId });
    expect(row.origin).toBe('erp_import');
    expect(row.organizationId).toBe(TEST_ORGANIZATION_ID);
    expect(row.externalDocumentRef?.externalId).toBe('xl-sale-doc-contract-1');
    expect(row.orderId ?? null).toBeNull();

    const attachments = await h.em().find(InvoiceExternalAttachment, { invoiceId: row.id });
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.externalAttachmentId).toBe('att-1');
  });

  it('is idempotent on (system, externalId)', async () => {
    const port = resolvePort(h);
    const input = {
      organizationId: TEST_ORGANIZATION_ID,
      externalDocumentRef: {
        system: 'comarch_xl' as const,
        externalId: 'xl-sale-doc-contract-idempotent',
        externalNumber: 'FV/XL/2026/2',
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

/**
 * Feature 134, T135 (`specs/134-paid-module-extraction/research.md` D21):
 * an imported document is identified by `(system, externalId)`. A second
 * source system's id space is unrelated to the first's, so the same id from
 * another system is another document — it must neither reach nor overwrite
 * the first one's row, organization or attachments.
 */
describe('invoices — imported-document identity is (system, externalId) [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedOtherTestOrganization(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function importInput(
    system: string,
    externalId: string,
    organizationId: string,
    overrides: Partial<ErpSaleDocumentUpsertInput> = {},
  ): ErpSaleDocumentUpsertInput {
    return {
      organizationId,
      externalDocumentRef: {
        system,
        externalId,
        externalNumber: `FV/${system}/${externalId}`,
        documentKind: 'invoice',
      },
      kind: 'invoice',
      // `invoices.number` is unique across every invoice; the source system's
      // number is not what this suite is about.
      number: `FV/${system}/${externalId}`,
      currency: 'PLN',
      issuedAt: '2026-09-26T10:00:00.000Z',
      grossTotal: '100.00',
      attachments: [
        {
          externalAttachmentId: `att-${system}`,
          fileName: `${system}.pdf`,
          contentType: 'application/pdf',
        },
      ],
      ...overrides,
    };
  }

  async function importedRows(externalId: string): Promise<InvoiceRow[]> {
    const rows = await h.em().find(Invoice, { origin: 'erp_import' });
    return rows.filter((row) => row.externalDocumentRef?.externalId === externalId);
  }

  it('(a) two systems, one externalId, two organizations: two rows, neither touched by the other', async () => {
    const port = resolvePort(h);
    const externalId = `shared-${randomUUID()}`;

    const first = await port.upsertImportedDocument(
      importInput('comarch_xl', externalId, TEST_ORGANIZATION_ID, { grossTotal: '111.00' }),
    );
    const second = await port.upsertImportedDocument(
      importInput('erp_fixture', externalId, OTHER_TEST_ORGANIZATION_ID, {
        number: 'FV/OTHER/9',
        grossTotal: '999.00',
      }),
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.invoiceId).not.toBe(first.invoiceId);
    expect(await importedRows(externalId)).toHaveLength(2);

    const em = h.em();
    const firstRow = await em.findOneOrFail(Invoice, { id: first.invoiceId });
    expect(firstRow.organizationId).toBe(TEST_ORGANIZATION_ID);
    expect(firstRow.externalDocumentRef?.system).toBe('comarch_xl');
    expect(firstRow.number).toBe(`FV/comarch_xl/${externalId}`);
    expect(firstRow.total).toBe('111.00');
    const firstAttachments = await em.find(InvoiceExternalAttachment, {
      invoiceId: first.invoiceId,
    });
    expect(firstAttachments.map((row) => row.externalAttachmentId)).toEqual(['att-comarch_xl']);

    const secondRow = await em.findOneOrFail(Invoice, { id: second.invoiceId });
    expect(secondRow.organizationId).toBe(OTHER_TEST_ORGANIZATION_ID);
    expect(secondRow.externalDocumentRef?.system).toBe('erp_fixture');
    const secondAttachments = await em.find(InvoiceExternalAttachment, {
      invoiceId: second.invoiceId,
    });
    expect(secondAttachments.map((row) => row.externalAttachmentId)).toEqual(['att-erp_fixture']);
  });

  it('(b) the same (system, externalId) again updates the one row', async () => {
    const port = resolvePort(h);
    const externalId = `again-${randomUUID()}`;

    const first = await port.upsertImportedDocument(
      importInput('erp_fixture', externalId, TEST_ORGANIZATION_ID),
    );
    const again = await port.upsertImportedDocument(
      importInput('erp_fixture', externalId, TEST_ORGANIZATION_ID, { grossTotal: '150.00' }),
    );

    expect(again.created).toBe(false);
    expect(again.invoiceId).toBe(first.invoiceId);
    const rows = await importedRows(externalId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.total).toBe('150.00');
  });

  it('(c) refuses a payload in the pre-T135 key shape with the validation error, writing nothing', async () => {
    const port = resolvePort(h);
    const externalId = `old-shape-${randomUUID()}`;
    const oldShape = {
      ...importInput('comarch_xl', externalId, TEST_ORGANIZATION_ID),
      externalDocumentRef: {
        system: 'comarch_xl',
        xlSaleDocumentId: externalId,
        xlDocumentNumber: 'FV/XL/OLD/1',
        documentKind: 'invoice',
      },
      attachments: [{ xlAttachmentId: 'att-old', fileName: 'old.pdf' }],
    } as unknown as ErpSaleDocumentUpsertInput;

    await expect(port.upsertImportedDocument(oldShape)).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_FAILED,
    });

    const rows = await h.em().getConnection().execute<Array<{ count: string }>>(
      `select count(*)::text as count from invoices
        where origin = 'erp_import'
          and (external_document_ref->>'xlSaleDocumentId' = ?
               or external_document_ref->>'externalId' = ?)`,
      [externalId, externalId],
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('(d) resolveAttachmentContext answers externalId and externalAttachmentId', async () => {
    const port = resolvePort(h);
    const externalId = `context-${randomUUID()}`;
    const imported = await port.upsertImportedDocument(
      importInput('erp_fixture', externalId, TEST_ORGANIZATION_ID),
    );
    const attachment = await h
      .em()
      .findOneOrFail(InvoiceExternalAttachment, { invoiceId: imported.invoiceId });

    const context = await port.resolveAttachmentContext({
      invoiceId: imported.invoiceId,
      attachmentId: attachment.id,
      organizationId: TEST_ORGANIZATION_ID,
    });

    expect(context).toEqual({
      system: 'erp_fixture',
      externalId,
      externalAttachmentId: 'att-erp_fixture',
      fileName: 'erp_fixture.pdf',
      contentType: 'application/pdf',
    });
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
        externalId: 'xl-sale-doc-customer-list',
        externalNumber: 'WZ/XL/2026/1',
        documentKind: 'wz',
      },
      kind: 'wz',
      number: 'WZ/XL/2026/1',
      currency: 'PLN',
      issuedAt: '2026-09-14T12:00:00.000Z',
      grossTotal: '100.00',
      attachments: [
        {
          externalAttachmentId: 'att-customer',
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

  // Feature 134, T061/T065 (`research.md` D12): the source system is open, and
  // the attachment seam dispatches on it. A system no connector registered a
  // fetch provider for is answered like any attachment that cannot be fetched.
  it('answers 404 for an attachment from a source system no connector serves', async () => {
    const port = resolvePort(h);
    const imported = await port.upsertImportedDocument({
      organizationId: TEST_ORGANIZATION_ID,
      externalDocumentRef: {
        system: 'erp_unregistered',
        externalId: 'unregistered-system-doc-1',
        documentKind: 'invoice',
      },
      kind: 'invoice',
      number: 'FV/UNREG/2026/1',
      currency: 'PLN',
      issuedAt: '2026-09-14T13:00:00.000Z',
      grossTotal: '10.00',
      attachments: [
        { externalAttachmentId: 'att-unregistered', fileName: 'x.pdf', contentType: 'application/pdf' },
      ],
    });
    const attachment = await h
      .em()
      .findOneOrFail(InvoiceExternalAttachment, { invoiceId: imported.invoiceId });

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/account/organization/invoices/${imported.invoiceId}/attachments/${attachment.id}`,
      cookies: CUSTOMER_COOKIE,
    });
    expect(res.statusCode, res.body).toBe(404);
  });

  it('registers the attachment fetch seam ungated, under its contract name', () => {
    const registry = h.container.resolve<InvoiceAttachmentFetchRegistryPort>(
      INVOICE_ATTACHMENT_FETCH_REGISTRY,
    );
    expect(typeof registry.register).toBe('function');
  });
});
