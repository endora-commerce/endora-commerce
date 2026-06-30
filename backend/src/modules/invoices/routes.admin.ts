import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { issueInvoiceRequestSchema, sendInvoiceEmailRequestSchema } from '@b2b/contracts';
import { Invoice } from './entities/invoice.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import { z } from 'zod';
import type { InvoiceService } from './services/invoice-service.js';
import type { InvoicePdfRenderer } from './services/invoice-pdf-renderer.js';
import type { InvoiceTemplateService } from './services/invoice-template-service.js';
import { INVOICE_PAGE_BUILDER_DESCRIPTOR } from './pdf-components/descriptor.js';
import { sampleInvoiceDetail } from './pdf-components/sample.js';

/** Minimal email-dispatch seam — implemented by the US5 dispatcher. */
export interface InvoiceEmailDispatcher {
  dispatch(
    invoiceId: string,
    opts?: { mode?: 'attachment' | 'link'; messageId?: string },
  ): Promise<boolean>;
  sendOnIssueEnabled(salesChannelId: string | null): Promise<boolean>;
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
  templateService: InvoiceTemplateService;
  emailDispatcher?: InvoiceEmailDispatcher;
  resolveAdminUserId?: (req: FastifyRequest) => string | null;
}

const RENDER_LANGUAGE = 'pl-PL';

export async function registerInvoicesAdminRoutes(
  app: FastifyInstance,
  deps: InvoicesAdminDeps,
): Promise<void> {
  const { emFactory, requireAdmin, invoiceService, pdfRenderer, templateService } = deps;

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
      const total: Record<string, number> = {};
      if (q['filter[totalMin]'] && Number.isFinite(Number(q['filter[totalMin]'])))
        total['$gte'] = Number(q['filter[totalMin]']);
      if (q['filter[totalMax]'] && Number.isFinite(Number(q['filter[totalMax]'])))
        total['$lte'] = Number(q['filter[totalMax]']);
      if (Object.keys(total).length) where['total'] = total;

      const em = emFactory();

      // Filter by order number (business id): resolve matching orders first,
      // then constrain invoices to those order ids. A no-match short-circuits.
      const orderNumber = q['filter[orderNumber]']?.trim();
      if (orderNumber) {
        const matchingOrders = await em.find(
          Order,
          { businessId: { $ilike: `%${orderNumber}%` } },
          { fields: ['id'], limit: 500 },
        );
        if (matchingOrders.length === 0) {
          return { data: [], pagination: { cursor: null, hasMore: false, limit: 0 } };
        }
        where['orderId'] = { $in: matchingOrders.map((o) => o.id) };
      }

      const limit = Math.min(Math.max(Number.parseInt(q['limit'] ?? '50', 10), 1), 200);
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
      const tree = await templateService.resolveTree(detail.salesChannelId, RENDER_LANGUAGE);
      const pdf = await pdfRenderer.render(detail, 'pl', tree);
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
      // Best-effort send-on-issue (FR-024); never fails the issuance.
      if (deps.emailDispatcher && (await deps.emailDispatcher.sendOnIssueEnabled(detail.salesChannelId))) {
        await deps.emailDispatcher.dispatch(detail.id);
      }
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

  // --- Invoice templates (US6) ------------------------------------------
  app.get(
    '/api/v1/admin/invoice-templates',
    { preHandler: requireAdmin('invoices:read') },
    async () => ({ data: await templateService.list() }),
  );

  app.get(
    '/api/v1/admin/invoice-templates/page-builder/config',
    { preHandler: requireAdmin('invoices:read') },
    async () => ({ data: INVOICE_PAGE_BUILDER_DESCRIPTOR }),
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/invoice-templates/:id',
    { preHandler: requireAdmin('invoices:read') },
    async (request) => ({ data: await templateService.get(request.params.id) }),
  );

  const createTemplateSchema = z.object({
    code: z.string().min(1).max(180),
    name: z.string().min(1).max(200),
    salesChannelId: z.string().uuid().nullable().optional(),
  });
  app.post(
    '/api/v1/admin/invoice-templates',
    { preHandler: requireAdmin('invoices:write'), schema: { body: createTemplateSchema } },
    async (request, reply) => {
      const body = createTemplateSchema.parse(request.body);
      const created = await templateService.create({
        code: body.code,
        name: body.name,
        salesChannelId: body.salesChannelId ?? null,
      });
      reply.status(201);
      return { data: created };
    },
  );

  const saveContentSchema = z.object({ data: z.unknown(), version: z.number().int() });
  app.put<{ Params: { id: string; language: string } }>(
    '/api/v1/admin/invoice-templates/:id/content/:language',
    { preHandler: requireAdmin('invoices:write'), schema: { body: saveContentSchema } },
    async (request) => {
      const body = saveContentSchema.parse(request.body);
      return {
        data: await templateService.saveContent(
          request.params.id,
          request.params.language,
          body.data,
          body.version,
        ),
      };
    },
  );

  // Preview: render a sample invoice through the template's tree (GET so it can
  // be opened directly as a link from the admin editor).
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/invoice-templates/:id/preview',
    { preHandler: requireAdmin('invoices:write') },
    async (request, reply) => {
      const tpl = await templateService.get(request.params.id);
      const tree = await templateService.resolveTree(tpl.salesChannelId, RENDER_LANGUAGE);
      const pdf = await pdfRenderer.render(sampleInvoiceDetail(), 'pl', tree);
      reply.header('content-type', 'application/pdf').header('content-disposition', 'inline; filename="preview.pdf"');
      return reply.send(pdf);
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
