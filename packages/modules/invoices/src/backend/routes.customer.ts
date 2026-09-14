import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '@endora-commerce/platform/http';
import {
  ERROR_CODES,
  type AssetReadPort,
  type ComarchXlSaleDocumentAttachmentPort,
  type OrderReadPort,
  type OrderRecord,
} from '@endora-commerce/contracts';
import { InvoiceExternalAttachment } from './entities/invoice-external-attachment.entity.js';
import { Invoice } from './entities/invoice.entity.js';
import type { InvoiceService } from './services/invoice-service.js';
import type { InvoicePdfRenderer } from './services/invoice-pdf-renderer.js';
import type { InvoiceTemplateService } from './services/invoice-template-service.js';

export interface InvoicesCustomerDeps {
  emFactory: () => EntityManager;
  /** `orders`' published read model — the ownership check (feature 075, Phase C). */
  orderReadPort: OrderReadPort;
  assetReadPort: AssetReadPort;
  saleDocumentAttachments: ComarchXlSaleDocumentAttachmentPort;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => { customerAccountId: string; organizationId: string };
  invoiceService: InvoiceService;
  pdfRenderer: InvoicePdfRenderer;
  templateService: InvoiceTemplateService;
}

/**
 * Storefront customer invoice routes (feature 047, US4). A customer lists and
 * downloads invoices for an order they (or their organization) own. Only
 * `ready` invoices are exposed.
 */
export async function registerInvoicesCustomerRoutes(
  app: FastifyInstance,
  deps: InvoicesCustomerDeps,
): Promise<void> {
  const {
    emFactory,
    orderReadPort,
    assetReadPort,
    saleDocumentAttachments,
    requireCustomer,
    resolveCustomerContext,
    invoiceService,
    pdfRenderer,
    templateService,
  } = deps;

  async function ownedOrderOr404(req: FastifyRequest, orderId: string): Promise<OrderRecord> {
    const ctx = resolveCustomerContext(req);
    const order = await orderReadPort.findById(orderId);
    if (
      !order ||
      (order.placedByCustomerAccountId !== ctx.customerAccountId &&
        order.organizationId !== ctx.organizationId)
    ) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
    }
    return order;
  }

  app.get<{ Params: { id: string } }>(
    '/api/v1/orders/:id/invoices',
    { preHandler: requireCustomer },
    async (request) => {
      await ownedOrderOr404(request, request.params.id);
      const em = emFactory();
      const rows = await em.find(
        Invoice,
        { orderId: request.params.id, status: 'ready' },
        { orderBy: { issuedAt: 'desc' } },
      );
      return {
        data: rows.map((i) => ({
          id: i.id,
          kind: i.kind,
          number: i.number,
          issuedAt: i.issuedAt.toISOString(),
          currency: i.currency,
          total: Number(i.total),
          downloadHref: `/api/v1/orders/${request.params.id}/invoices/${i.id}/pdf`,
        })),
      };
    },
  );

  app.get<{ Params: { id: string; invoiceId: string } }>(
    '/api/v1/orders/:id/invoices/:invoiceId/pdf',
    { preHandler: requireCustomer, config: { streamingResponse: true } },
    async (request, reply) => {
      await ownedOrderOr404(request, request.params.id);
      const em = emFactory();
      const inv = await em.findOne(Invoice, {
        id: request.params.invoiceId,
        orderId: request.params.id,
        status: 'ready',
      });
      if (!inv) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Invoice not found.');
      const detail = await invoiceService.buildDetail(inv.id);
      const tree = await templateService.resolveTree(detail.salesChannelId, 'pl-PL');
      const pdf = await pdfRenderer.render(detail, 'pl', tree);
      reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="invoice-${detail.number.replace(/\W+/g, '_')}.pdf"`);
      return reply.send(pdf);
    },
  );

  app.get(
    '/api/v1/account/organization/sale-documents',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const em = emFactory();
      const rows = await em.find(
        Invoice,
        { origin: 'erp_import', organizationId: ctx.organizationId, status: 'ready' },
        { orderBy: { issuedAt: 'desc' } },
      );
      const attachmentsByInvoice = new Map<string, InvoiceExternalAttachment[]>();
      if (rows.length > 0) {
        const attachments = await em.find(InvoiceExternalAttachment, {
          invoiceId: { $in: rows.map((row) => row.id) },
        });
        for (const attachment of attachments) {
          const bucket = attachmentsByInvoice.get(attachment.invoiceId) ?? [];
          bucket.push(attachment);
          attachmentsByInvoice.set(attachment.invoiceId, bucket);
        }
      }
      return {
        data: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          number: row.number,
          documentKind: row.externalDocumentRef?.documentKind ?? 'invoice',
          issuedAt: row.issuedAt.toISOString(),
          currency: row.currency,
          total: Number(row.total),
          orderId: row.orderId ?? null,
          attachments: (attachmentsByInvoice.get(row.id) ?? []).map((attachment) => ({
            id: attachment.id,
            fileName: attachment.fileName,
            contentType: attachment.contentType ?? null,
            downloadHref: `/api/v1/account/organization/sale-documents/${row.id}/attachments/${attachment.id}`,
          })),
        })),
      };
    },
  );

  app.get<{ Params: { invoiceId: string; attachmentId: string } }>(
    '/api/v1/account/organization/sale-documents/:invoiceId/attachments/:attachmentId',
    { preHandler: requireCustomer, config: { streamingResponse: true } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const em = emFactory();
      const invoice = await em.findOne(Invoice, {
        id: request.params.invoiceId,
        origin: 'erp_import',
        organizationId: ctx.organizationId,
        status: 'ready',
      });
      if (!invoice) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Sale document not found.');
      }
      const attachment = await em.findOne(InvoiceExternalAttachment, {
        id: request.params.attachmentId,
        invoiceId: invoice.id,
      });
      if (!attachment) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Attachment not found.');
      }
      if (!attachment.assetId) {
        const ensured = await saleDocumentAttachments.ensureAttachmentBytes({
          invoiceId: invoice.id,
          attachmentId: attachment.id,
          organizationId: ctx.organizationId,
        });
        if (!ensured) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Attachment not found.');
        }
        attachment.assetId = ensured.assetId;
      }
      const asset = await assetReadPort.findById(attachment.assetId);
      if (!asset?.storageUrl) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Attachment not found.');
      }
      return reply.redirect(asset.storageUrl);
    },
  );
}
