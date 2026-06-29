import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { issueInvoiceRequestSchema, sendInvoiceEmailRequestSchema } from '@b2b/contracts';
import { Invoice } from './entities/invoice.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { InvoiceService } from './services/invoice-service.js';
import type { InvoicePdfRenderer } from './services/invoice-pdf-renderer.js';

/** Minimal email-dispatch seam — implemented by the US5 dispatcher. */
export interface InvoiceEmailDispatcher {
  dispatch(
    invoiceId: string,
    opts: { mode?: 'attachment' | 'link'; messageId: string },
  ): Promise<boolean>;
}

/**
 * Admin invoice routes (feature 047). Browse/list, view detail, download the
 * PDF (rendered on demand), issue an invoice/proforma for an order, regenerate
 * the PDF, and (re)send the invoice email.
 */
export interface InvoicesAdminDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  invoiceService: InvoiceService;
  pdfRenderer: InvoicePdfRenderer;
  emailDispatcher?: InvoiceEmailDispatcher;
  resolveAdminUserId?: (req: FastifyRequest) => string | null;
}

export async function registerInvoicesAdminRoutes(
  app: FastifyInstance,
  deps: InvoicesAdminDeps,
): Promise<void> {
  const { emFactory, requireAdmin, invoiceService, pdfRenderer } = deps;

  // List ------------------------------------------------------------------
  app.get(
    '/api/v1/admin/invoices',
    { preHandler: requireAdmin('invoices:read') },
    async (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const where: Record<string, unknown> = {};
      if (q['filter[status]']) where['status'] = q['filter[status]'];
      if (q['filter[orderId]']) where['orderId'] = q['filter[orderId]'];
      if (q['filter[kind]']) where['kind'] = q['filter[kind]'];
      if (q['filter[salesChannelId]']) where['salesChannelId'] = q['filter[salesChannelId]'];
      const issuedAt: Record<string, Date> = {};
      if (q['filter[issuedFrom]']) issuedAt['$gte'] = new Date(q['filter[issuedFrom]'] as string);
      if (q['filter[issuedTo]']) issuedAt['$lte'] = new Date(q['filter[issuedTo]'] as string);
      if (Object.keys(issuedAt).length) where['issuedAt'] = issuedAt;

      const limit = Math.min(Math.max(Number.parseInt(q['limit'] ?? '50', 10), 1), 200);
      const em = emFactory();
      const rows = await em.find(Invoice, where, { orderBy: { issuedAt: 'desc' }, limit });
      const orderIds = [...new Set(rows.map((r) => r.orderId))];
      const orders = orderIds.length
        ? await em.find(Order, { id: { $in: orderIds } }, { fields: ['id', 'businessId'] })
        : [];
      const byOrder = new Map(orders.map((o) => [o.id, o.businessId]));
      return {
        data: rows.map((i) => serialize(i, byOrder.get(i.orderId) ?? null)),
        pagination: { cursor: null, hasMore: false, limit: rows.length },
      };
    },
  );

  // Detail ----------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/invoices/:id',
    { preHandler: requireAdmin('invoices:read') },
    async (request) => {
      return { data: await invoiceService.buildDetail(request.params.id) };
    },
  );

  // PDF (rendered on demand) ---------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/invoices/:id/pdf',
    { preHandler: requireAdmin('invoices:read') },
    async (request, reply) => {
      const detail = await invoiceService.buildDetail(request.params.id);
      const pdf = await pdfRenderer.render(detail);
      reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="invoice-${detail.number.replace(/\W+/g, '_')}.pdf"`);
      return reply.send(pdf);
    },
  );

  // Issue an invoice/proforma for an order -------------------------------
  app.post<{ Params: { orderId: string } }>(
    '/api/v1/admin/orders/:orderId/invoices',
    { preHandler: requireAdmin('invoices:write'), schema: { body: issueInvoiceRequestSchema } },
    async (request, reply) => {
      const body = issueInvoiceRequestSchema.parse(request.body ?? {});
      const issuedBy = deps.resolveAdminUserId?.(request) ?? undefined;
      const detail = await invoiceService.issue(request.params.orderId, body.kind, {
        ...(body.saleDate ? { saleDate: body.saleDate } : {}),
        ...(body.paymentDueDate ? { paymentDueDate: body.paymentDueDate } : {}),
        ...(issuedBy ? { issuedBy } : {}),
      });
      reply.status(201);
      return { data: detail };
    },
  );

  // Regenerate PDF (no-op for on-demand rendering; kept for the contract) -
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/invoices/:id/regenerate-pdf',
    { preHandler: requireAdmin('invoices:write') },
    async (request) => {
      return { data: await invoiceService.buildDetail(request.params.id) };
    },
  );

  // (Re)send the invoice email -------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/invoices/:id/send-email',
    { preHandler: requireAdmin('invoices:write'), schema: { body: sendInvoiceEmailRequestSchema } },
    async (request) => {
      const body = sendInvoiceEmailRequestSchema.parse(request.body ?? {});
      if (!deps.emailDispatcher) {
        return { data: { ok: false, reason: 'email_not_configured' } };
      }
      const messageId = `invoice_issued:${request.params.id}:resend:${Date.now()}`;
      const ok = await deps.emailDispatcher.dispatch(request.params.id, {
        ...(body.mode ? { mode: body.mode } : {}),
        messageId,
      });
      return { data: { ok } };
    },
  );
}

function serialize(i: Invoice, orderBusinessId: string | null) {
  return {
    id: i.id,
    orderId: i.orderId,
    orderBusinessId,
    salesChannelId: i.salesChannelId ?? null,
    kind: i.kind,
    number: i.number,
    issuedAt: i.issuedAt.toISOString(),
    currency: i.currency,
    total: Number(i.total),
    status: i.status,
    pdfReady: i.status === 'ready',
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}
