import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../http/error-envelope.js';
import { ERROR_CODES } from '@b2b/contracts';
import { Invoice } from './entities/invoice.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import type { InvoiceService } from './services/invoice-service.js';
import type { InvoicePdfRenderer } from './services/invoice-pdf-renderer.js';
import type { InvoiceTemplateService } from './services/invoice-template-service.js';

export interface InvoicesCustomerDeps {
  emFactory: () => EntityManager;
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
  const { emFactory, requireCustomer, resolveCustomerContext, invoiceService, pdfRenderer, templateService } = deps;

  async function ownedOrderOr404(req: FastifyRequest, orderId: string): Promise<Order> {
    const ctx = resolveCustomerContext(req);
    const em = emFactory();
    const order = await em.findOne(Order, { id: orderId });
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
}
