import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type ErpSaleDocumentAttachmentInput,
  type ErpSaleDocumentUpsertInput,
  type ErpSaleDocumentUpsertResult,
  type ErpSaleDocumentWritePort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { isOrgInScope } from '@endora-commerce/platform/tenancy';
import { InvoiceExternalAttachment } from '../entities/invoice-external-attachment.entity.js';
import { Invoice } from '../entities/invoice.entity.js';

export class ErpSaleDocumentWritePortService implements ErpSaleDocumentWritePort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async upsertImportedDocument(
    input: ErpSaleDocumentUpsertInput,
  ): Promise<ErpSaleDocumentUpsertResult> {
    if (!isOrgInScope(input.organizationId)) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
    }

    const em = this.emFactory();
    const existing = await this.findByXlSaleDocumentId(
      em,
      input.externalDocumentRef.xlSaleDocumentId,
    );

    if (existing) {
      this.applyHeader(existing, input);
      await this.syncAttachments(em, existing, input.attachments ?? []);
      await em.flush();
      return { invoiceId: existing.id, created: false };
    }

    const invoice = em.create(Invoice, {
      origin: 'erp_import',
      organizationId: input.organizationId,
      orderId: input.orderId ?? null,
      externalDocumentRef: input.externalDocumentRef,
      kind: input.kind,
      number: input.number,
      currency: input.currency,
      issuedAt: new Date(input.issuedAt),
      saleDate: input.saleDate ?? null,
      paymentDueDate: input.paymentDueDate ?? null,
      paymentMethod: input.paymentMethod ?? null,
      netTotal: input.netTotal ?? null,
      taxTotal: input.taxTotal ?? null,
      total: input.grossTotal,
      paidTotal: input.paidTotal ?? '0',
      buyerSnapshot: input.buyerSnapshot ?? null,
      status: 'ready',
    });
    await em.persistAndFlush(invoice);
    await this.syncAttachments(em, invoice, input.attachments ?? []);
    await em.flush();
    return { invoiceId: invoice.id, created: true };
  }

  async resolveAttachmentContext(input: {
    invoiceId: string;
    attachmentId: string;
    organizationId: string;
  }): Promise<{
    xlSaleDocumentId: string;
    xlAttachmentId: string;
    fileName: string;
    contentType: string | null;
  } | null> {
    const em = this.emFactory();
    const invoice = await em.findOne(Invoice, {
      id: input.invoiceId,
      origin: 'erp_import',
      organizationId: input.organizationId,
      status: 'ready',
    });
    if (!invoice?.externalDocumentRef?.xlSaleDocumentId) {
      return null;
    }

    const attachment = await em.findOne(InvoiceExternalAttachment, {
      id: input.attachmentId,
      invoiceId: invoice.id,
    });
    if (!attachment) {
      return null;
    }

    return {
      xlSaleDocumentId: invoice.externalDocumentRef.xlSaleDocumentId,
      xlAttachmentId: attachment.xlAttachmentId,
      fileName: attachment.fileName,
      contentType: attachment.contentType ?? null,
    };
  }

  async linkAttachmentAsset(input: {
    invoiceId: string;
    attachmentId: string;
    organizationId: string;
    assetId: string;
    contentType?: string | null;
  }): Promise<boolean> {
    const em = this.emFactory();
    const invoice = await em.findOne(Invoice, {
      id: input.invoiceId,
      origin: 'erp_import',
      organizationId: input.organizationId,
      status: 'ready',
    });
    if (!invoice) return false;

    const attachment = await em.findOne(InvoiceExternalAttachment, {
      id: input.attachmentId,
      invoiceId: invoice.id,
    });
    if (!attachment) return false;

    attachment.assetId = input.assetId;
    if (input.contentType !== undefined) {
      attachment.contentType = input.contentType;
    }
    attachment.downloadedAt = new Date();
    await em.flush();
    return true;
  }

  private async findByXlSaleDocumentId(
    em: EntityManager,
    xlSaleDocumentId: string,
  ): Promise<Invoice | null> {
    const rows = await em.getConnection().execute<Array<{ id: string }>>(
      `select id from invoices where origin = 'erp_import' and external_document_ref->>'xlSaleDocumentId' = ? limit 1`,
      [xlSaleDocumentId],
    );
    const id = rows[0]?.id;
    return id ? em.findOne(Invoice, { id }) : null;
  }

  private applyHeader(invoice: Invoice, input: ErpSaleDocumentUpsertInput): void {
    invoice.organizationId = input.organizationId;
    invoice.orderId = input.orderId ?? null;
    invoice.externalDocumentRef = input.externalDocumentRef;
    invoice.kind = input.kind;
    invoice.number = input.number;
    invoice.currency = input.currency;
    invoice.issuedAt = new Date(input.issuedAt);
    invoice.saleDate = input.saleDate ?? null;
    invoice.paymentDueDate = input.paymentDueDate ?? null;
    invoice.paymentMethod = input.paymentMethod ?? null;
    invoice.netTotal = input.netTotal ?? null;
    invoice.taxTotal = input.taxTotal ?? null;
    invoice.total = input.grossTotal;
    if (input.paidTotal !== undefined) {
      invoice.paidTotal = input.paidTotal;
    }
    if (input.buyerSnapshot !== undefined) {
      invoice.buyerSnapshot = input.buyerSnapshot;
    }
    invoice.status = 'ready';
  }

  private async syncAttachments(
    em: EntityManager,
    invoice: Invoice,
    attachments: readonly ErpSaleDocumentAttachmentInput[],
  ): Promise<void> {
    if (attachments.length === 0) return;

    const existing = await em.find(InvoiceExternalAttachment, { invoiceId: invoice.id });
    const byXlId = new Map(existing.map((row) => [row.xlAttachmentId, row]));

    for (const attachment of attachments) {
      const row = byXlId.get(attachment.xlAttachmentId);
      if (row) {
        row.fileName = attachment.fileName;
        row.contentType = attachment.contentType ?? null;
        continue;
      }
      em.create(InvoiceExternalAttachment, {
        invoiceId: invoice.id,
        xlAttachmentId: attachment.xlAttachmentId,
        fileName: attachment.fileName,
        contentType: attachment.contentType ?? null,
      });
    }
  }
}
