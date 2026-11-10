import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  type DocumentRenderPort,
  issueInvoiceRequestSchema,
  sendInvoiceEmailRequestSchema,
  type IssueInvoiceEmailOutcome,
  type OrderReadPort,
} from '@endora-commerce/contracts';
import { Invoice } from './entities/invoice.entity.js';
import { orgInScope } from '@endora-commerce/platform/tenancy';
import type { InvoiceService } from './services/invoice-service.js';
import { renderInvoicePdf } from './document/render-invoice.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { InvoiceEmailDispatchResult } from './services/invoice-email-dispatch.js';

/** Minimal email-dispatch seam — implemented by the US5 dispatcher. */
export interface InvoiceEmailDispatcher {
  dispatch(
    invoiceId: string,
    opts?: { mode?: 'attachment' | 'link'; messageId?: string },
  ): Promise<InvoiceEmailDispatchResult>;
  sendOnIssueEnabled(salesChannelId: string | null): Promise<boolean>;
}

/**
 * Admin invoice routes (feature 047). Browse/list, view detail, download the
 * PDF (rendered on demand), issue an invoice/proforma for an order, regenerate
 * the PDF, and (re)send the invoice email.
 */
export interface InvoicesAdminDeps {
  emFactory: () => EntityManager;
  /** `orders`' published read model (feature 075, Phase C). */
  orderReadPort: OrderReadPort;
  requireAdmin: RequireAdminFactory;
  invoiceService: InvoiceService;
  /** `document_templates`' render port (`specs/152-compare-pdf-template/`). */
  documents: Pick<DocumentRenderPort, 'render'>;
  /**
   * T118c — required, both of them. Each was optional because the *bridge*
   * member behind it was, and a composition that omitted one got a route that
   * silently did less: no dispatcher meant every issue answered
   * `not_sent` / `no_sender`, and no resolver meant every invoice was recorded
   * as issued by nobody. The module resolves both itself now.
   */
  emailDispatcher: InvoiceEmailDispatcher;
  resolveAdminUserId: (req: FastifyRequest) => string | null;
}

export async function registerInvoicesAdminRoutes(
  app: FastifyInstance,
  deps: InvoicesAdminDeps,
): Promise<void> {
  const { emFactory, orderReadPort, requireAdmin, invoiceService, documents } = deps;

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
      //
      // Feature 080, T048 (D-169) — the lookup is `orders`' own search now. It
      // was `em.find(Order, { businessId: { $ilike } }, { limit: 500 })` here,
      // a plain read of that module's table, so it takes a read-port method and
      // not an `EntityManager`-taking apply port. The short-circuit is what
      // made it worth cutting: an absent `orders` used to answer "no invoice
      // for that order number" out of a table nobody was serving.
      const orderNumber = q['filter[orderNumber]']?.trim();
      if (orderNumber) {
        const matchingOrderIds = await orderReadPort.findIdsByBusinessIdLike(orderNumber, 500);
        if (matchingOrderIds.length === 0) {
          return { data: [], pagination: { cursor: null, hasMore: false, limit: 0 } };
        }
        where['orderId'] = { $in: matchingOrderIds };
      }

      const limit = Math.min(Math.max(Number.parseInt(q['limit'] ?? '50', 10), 1), 200);
      const rows = await em.find(Invoice, where, { orderBy: { issuedAt: 'desc' }, limit });
      const orderIds = [
        ...new Set(rows.map((r) => r.orderId).filter((id): id is string => id != null)),
      ];
      // Feature 075, Phase C — the order number and the owning organisation are
      // `orders`' fields, read over its port rather than out of its table.
      const orders = await orderReadPort.findByIds(orderIds);
      const byOrder = new Map(orders.map((o) => [o.id, o.businessId]));
      const orgByOrder = new Map(orders.map((o) => [o.id, o.organizationId]));
      // Feature 050 — Invoice is transitively scoped via its Order's org; hide
      // invoices whose order is out of the ambient tenant scope. ERP-imported
      // rows without an order scope directly on `organizationId` (feature 119).
      const visible = await Promise.all(
        rows.map((i) =>
          i.origin === 'erp_import'
            ? orgInScope(i.organizationId ?? '')
            : orgInScope(orgByOrder.get(i.orderId ?? '') ?? ''),
        ),
      );
      const scoped = rows.filter((_, index) => visible[index]);
      return {
        data: scoped.map((i) => serialize(i, i.orderId ? (byOrder.get(i.orderId) ?? null) : null)),
        pagination: { cursor: null, hasMore: false, limit: scoped.length },
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
    { preHandler: requireAdmin('invoices:read'), config: { streamingResponse: true } },
    async (request, reply) => {
      const detail = await invoiceService.buildDetail(request.params.id);
      const pdf = await renderInvoicePdf(documents, detail);
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
      const issuedBy = deps.resolveAdminUserId(request) ?? undefined;
      const detail = await invoiceService.issue(request.params.orderId, body.kind, {
        ...(body.saleDate ? { saleDate: body.saleDate } : {}),
        ...(body.paymentDueDate ? { paymentDueDate: body.paymentDueDate } : {}),
        ...(issuedBy ? { issuedBy } : {}),
      });
      const email = await sendOnIssue(deps, detail.id, detail.salesChannelId, detail.status);
      // Still a 201 whatever `email` says: the notification is best-effort
      // (FR-024) and a suppressed message must not undo an issued document.
      reply.status(201);
      return { data: detail, email };
    },
  );

  // Regenerate PDF — the PDF is rendered on demand, so "regenerate" actually
  // re-runs the full render pipeline (document template + pdfmake) to validate that
  // a fresh document can be produced and to surface any rendering error to the
  // operator instead of silently doing nothing. Returns the refreshed detail.
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/invoices/:id/regenerate-pdf',
    { preHandler: requireAdmin('invoices:write') },
    async (request) => {
      const detail = await invoiceService.buildDetail(request.params.id);
      await renderInvoicePdf(documents, detail);
      return { data: detail };
    },
  );

  // (Re)send the invoice email -------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/invoices/:id/send-email',
    { preHandler: requireAdmin('invoices:write'), schema: { body: sendInvoiceEmailRequestSchema } },
    async (request) => {
      const body = sendInvoiceEmailRequestSchema.parse(request.body ?? {});
      // The `if (!deps.emailDispatcher)` arm that stood here is gone with T118c
      // and `no_sender` is not: a dispatcher always exists now, and it answers
      // that name itself when `transactional_emails` has announced no sender.
      // The reason word is unchanged — it was `email_not_configured` until
      // issue #149, an eighth word for one of the seven reasons a caller can
      // translate.
      const messageId = `invoice_issued:${request.params.id}:resend:${Date.now()}`;
      // Issue #103 — the operator asked for this send explicitly, so the reason
      // it did not happen belongs in the answer rather than only in the log.
      const result = await deps.emailDispatcher.dispatch(request.params.id, {
        ...(body.mode ? { mode: body.mode } : {}),
        messageId,
      });
      return {
        data: result.sent ? { ok: true } : { ok: false, reason: result.reason },
      };
    },
  );

  // The invoice-template administration API (`/api/v1/admin/invoice-templates*`)
  // was withdrawn when invoice templates moved into *Document templates*
  // (`specs/152-compare-pdf-template/`, owner answer N4).
}

/**
 * Send-on-issue, and what became of it (issue #149).
 *
 * The dispatch result used to be awaited and dropped, so an operator who
 * clicked "issue and send" was told "issued" whether the e-mail went out or was
 * suppressed for one of seven named reasons — the last site of the #67/#78/#115
 * family. Nothing catches here: `dispatch` contains its own failures and names
 * them in the result (FR-029), and the one thing it re-throws is a presence
 * answer that must reach the caller as a 503.
 */
async function sendOnIssue(
  deps: InvoicesAdminDeps,
  invoiceId: string,
  salesChannelId: string | null,
  invoiceStatus: string,
): Promise<IssueInvoiceEmailOutcome> {
  const dispatcher = deps.emailDispatcher;
  // The `if (!dispatcher)` arm that stood here is gone with T118c: the
  // dispatcher is built unconditionally, so "this composition has no e-mail
  // surface" is no longer a state. `no_sender` is still reachable and is still
  // the honest answer — it is the dispatcher's own, for a
  // `transactional_emails` that has not announced its sender.
  if (invoiceStatus === 'pending') return { status: 'not_requested' };
  if (!(await dispatcher.sendOnIssueEnabled(salesChannelId))) return { status: 'not_requested' };
  const result = await dispatcher.dispatch(invoiceId);
  return result.sent ? { status: 'sent' } : { status: 'not_sent', reason: result.reason };
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
