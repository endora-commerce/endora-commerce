import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type ErpSaleDocumentAttachmentContext,
  type ErpSaleDocumentAttachmentInput,
  type ErpSaleDocumentUpsertInput,
  type ErpSaleDocumentUpsertResult,
  type ErpSaleDocumentWritePort,
  erpSaleDocumentUpsertInputSchema,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { isOrgInScope } from '@endora-commerce/platform/tenancy';
import { InvoiceExternalAttachment } from '../entities/invoice-external-attachment.entity.js';
import { Invoice } from '../entities/invoice.entity.js';

export class ErpSaleDocumentWritePortService implements ErpSaleDocumentWritePort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async upsertImportedDocument(
    untrusted: ErpSaleDocumentUpsertInput,
  ): Promise<ErpSaleDocumentUpsertResult> {
    // command-coverage-ignore: projection of a sale document the ERP owns.
    // `origin: 'erp_import'` is the whole of this port's subject — the row
    // mirrors a document the source system issued, and the decision to issue
    // it was never taken in Endora, so there is no actor for a Command to name.
    // The run that carried it is recorded by the calling connector in its own
    // sync log. An Endora-issued invoice never reaches this method;
    // `InvoiceService` owns that path and audits it.
    //
    // The input is parsed rather than trusted to its TypeScript type: a writer
    // compiled against another version of the contract (feature 134, T135 —
    // the pre-T135 key shape) is refused here, loudly and with
    // nothing written, instead of by a database constraint.
    const parsed = erpSaleDocumentUpsertInputSchema.safeParse(untrusted);
    if (!parsed.success) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'Imported sale document failed validation.',
        parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          issue: issue.message,
        })),
      );
    }
    const input = parsed.data;
    if (!isOrgInScope(input.organizationId)) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
    }

    const em = this.emFactory();
    const existing = await this.findImportedDocument(em, {
      system: input.externalDocumentRef.system,
      externalId: input.externalDocumentRef.externalId,
    });

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
  }): Promise<ErpSaleDocumentAttachmentContext | null> {
    const em = this.emFactory();
    const invoice = await em.findOne(Invoice, {
      id: input.invoiceId,
      origin: 'erp_import',
      organizationId: input.organizationId,
      status: 'ready',
    });
    if (!invoice?.externalDocumentRef?.externalId) {
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
      system: invoice.externalDocumentRef.system,
      externalId: invoice.externalDocumentRef.externalId,
      externalAttachmentId: attachment.externalAttachmentId,
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
    // command-coverage-ignore: idempotent stamp of the asset id for an
    // attachment this port already imported. It records where the file was
    // stored, not that it should exist — the import above decided that.
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

  /**
   * The imported document with this identity, in any organization.
   *
   * Raw SQL, deliberately outside the tenant global filter: identity belongs to
   * the source document, not to an organization. Within one source system a
   * document the source system reassigns to another contractor moves with it —
   * that is the source system's decision, and `applyHeader` follows it. What the
   * identity does guarantee is that a document from **another** system can never
   * be reached (feature 134, T135; `research.md` D21 §3).
   *
   * The predicate states `invoices_external_document_uq`'s expression and
   * partial-index condition verbatim, so the planner can answer it from that
   * index.
   */
  private async findImportedDocument(
    em: EntityManager,
    identity: { system: string; externalId: string },
  ): Promise<Invoice | null> {
    const rows = await em.getConnection().execute<Array<{ id: string }>>(
      `select id from invoices
        where origin = 'erp_import'
          and (external_document_ref->>'system') = ?
          and (external_document_ref->>'externalId') = ?
        limit 1`,
      [identity.system, identity.externalId],
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
    // command-coverage-ignore: the attachment half of `upsertImportedDocument`,
    // which carries the decision and the exemption's reason. Split out for
    // readability only; it is never called from anywhere else.
    if (attachments.length === 0) return;

    const existing = await em.find(InvoiceExternalAttachment, { invoiceId: invoice.id });
    const byExternalId = new Map(existing.map((row) => [row.externalAttachmentId, row]));

    for (const attachment of attachments) {
      const row = byExternalId.get(attachment.externalAttachmentId);
      if (row) {
        row.fileName = attachment.fileName;
        row.contentType = attachment.contentType ?? null;
        continue;
      }
      em.create(InvoiceExternalAttachment, {
        invoiceId: invoice.id,
        externalAttachmentId: attachment.externalAttachmentId,
        fileName: attachment.fileName,
        contentType: attachment.contentType ?? null,
      });
    }
  }
}
