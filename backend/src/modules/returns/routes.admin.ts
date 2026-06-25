import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  adminAddCommentRequestSchema,
  adminRejectRequestSchema,
  adminTransitionRequestSchema,
  adminReturnsListQuerySchema,
  bulkTransitionRequestSchema,
  createReturnShipmentRequestSchema,
  returnDeliveryMethodCreateSchema,
  returnDeliveryMethodUpdateSchema,
  returnReasonCreateSchema,
  returnReasonUpdateSchema,
  returnSavedViewCreateSchema,
  returnSavedViewUpdateSchema,
  returnStatusCreateSchema,
  returnStatusUpdateSchema,
  returnTransitionsSetSchema,
  settlementRequestSchema,
} from '@b2b/contracts';
import type { ReturnCaseService } from './services/return-case-service.js';
import type { ReturnAuthorizationService } from './services/return-authorization-service.js';
import type { ReturnCommentService } from './services/return-comment-service.js';
import type { ReturnSettlementService } from './services/return-settlement-service.js';
import type { ReturnDeliveryMethodService } from './services/return-delivery-method-service.js';
import type { ReturnShipmentService } from './services/return-shipment-service.js';
import type { ReturnReasonService } from './services/return-reason-service.js';
import type { ReturnListService } from './services/return-list-service.js';
import type { ReturnListViewService } from './services/return-list-view-service.js';
import type { ReturnExportService } from './services/return-export-service.js';
import type { ReturnTransitionService } from './services/return-transition-service.js';
import type { ReturnStatusGraphService } from './services/return-status-graph-service.js';

type RequireAdmin = (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * Returns admin routes — feature 046 (US2 case authorization/rejection +
 * transitions; US3 configurable workflow). Read gates on `returns:read`,
 * mutations on `returns:write`.
 */
export interface ReturnsAdminRoutesDeps {
  caseService: ReturnCaseService;
  authorizationService: ReturnAuthorizationService;
  commentService: ReturnCommentService;
  settlementService: ReturnSettlementService;
  deliveryMethodService: ReturnDeliveryMethodService;
  shipmentService: ReturnShipmentService;
  reasonService: ReturnReasonService;
  listService: ReturnListService;
  listViewService: ReturnListViewService;
  exportService: ReturnExportService;
  transitions: ReturnTransitionService;
  graphService: ReturnStatusGraphService;
  requireAdmin: RequireAdmin;
  resolveAdminUserId: (req: FastifyRequest) => string;
}

export async function registerReturnsAdminRoutes(
  app: FastifyInstance,
  deps: ReturnsAdminRoutesDeps,
): Promise<void> {
  const {
    caseService,
    authorizationService,
    commentService,
    settlementService,
    deliveryMethodService,
    shipmentService,
    reasonService,
    listService,
    listViewService,
    exportService,
    transitions,
    graphService,
    requireAdmin,
    resolveAdminUserId,
  } = deps;

  // --- List, bulk actions, saved views, export (US8) ----------------------
  app.get(
    '/api/v1/admin/returns',
    { preHandler: requireAdmin('returns:read'), schema: { querystring: adminReturnsListQuerySchema } },
    async (request) => {
      const query = adminReturnsListQuerySchema.parse(request.query);
      return { data: await listService.list(query) };
    },
  );

  app.get(
    '/api/v1/admin/returns/export',
    { preHandler: requireAdmin('returns:read'), schema: { querystring: adminReturnsListQuerySchema } },
    async (request, reply) => {
      const query = adminReturnsListQuerySchema.parse(request.query);
      const { csv, rowCount, truncated } = await exportService.exportCsv(query);
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('x-export-row-count', String(rowCount));
      reply.header('x-export-truncated', String(truncated));
      return csv;
    },
  );

  app.post(
    '/api/v1/admin/returns/bulk-transition',
    { preHandler: requireAdmin('returns:write'), schema: { body: bulkTransitionRequestSchema } },
    async (request) => {
      const adminUserId = resolveAdminUserId(request);
      const body = bulkTransitionRequestSchema.parse(request.body);
      const data = await listService.bulkTransition(body.ids, body.to, adminUserId, body.reason);
      return { data };
    },
  );

  app.get('/api/v1/admin/returns/list-views', { preHandler: requireAdmin('returns:read') }, async (request) => {
    const adminUserId = resolveAdminUserId(request);
    return { data: await listViewService.listFor(adminUserId) };
  });

  app.post(
    '/api/v1/admin/returns/list-views',
    { preHandler: requireAdmin('returns:read'), schema: { body: returnSavedViewCreateSchema } },
    async (request, reply) => {
      const adminUserId = resolveAdminUserId(request);
      const body = returnSavedViewCreateSchema.parse(request.body);
      const data = await listViewService.create(adminUserId, body);
      reply.status(201);
      return { data };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/returns/list-views/:id',
    { preHandler: requireAdmin('returns:read'), schema: { body: returnSavedViewUpdateSchema } },
    async (request) => {
      const adminUserId = resolveAdminUserId(request);
      const body = returnSavedViewUpdateSchema.parse(request.body);
      const data = await listViewService.update(request.params.id, adminUserId, body);
      return { data };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/returns/list-views/:id',
    { preHandler: requireAdmin('returns:read') },
    async (request) => {
      const adminUserId = resolveAdminUserId(request);
      await listViewService.remove(request.params.id, adminUserId);
      return { data: { ok: true } };
    },
  );

  // --- Workflow configuration (US3) ---------------------------------------
  // Registered before `/:id` so the static `statuses` segment is unambiguous.
  app.get('/api/v1/admin/returns/statuses', { preHandler: requireAdmin('returns:read') }, async () => {
    const data = await graphService.listGraph();
    return { data };
  });

  app.post(
    '/api/v1/admin/returns/statuses',
    { preHandler: requireAdmin('returns:write'), schema: { body: returnStatusCreateSchema } },
    async (request, reply) => {
      const body = returnStatusCreateSchema.parse(request.body);
      await graphService.createStatus({
        code: body.code,
        name: body.name,
        defaultName: body.defaultName,
        isTerminal: body.isTerminal,
        weight: body.weight,
        color: body.color,
      });
      reply.status(201);
      return { data: await graphService.listGraph() };
    },
  );

  app.patch<{ Params: { code: string } }>(
    '/api/v1/admin/returns/statuses/:code',
    { preHandler: requireAdmin('returns:write'), schema: { body: returnStatusUpdateSchema } },
    async (request) => {
      const body = returnStatusUpdateSchema.parse(request.body);
      await graphService.updateStatus(request.params.code, body);
      return { data: await graphService.listGraph() };
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/returns/statuses/:code',
    { preHandler: requireAdmin('returns:write') },
    async (request) => {
      await graphService.deleteStatus(request.params.code);
      return { data: await graphService.listGraph() };
    },
  );

  app.put(
    '/api/v1/admin/returns/transitions',
    { preHandler: requireAdmin('returns:write'), schema: { body: returnTransitionsSetSchema } },
    async (request) => {
      const body = returnTransitionsSetSchema.parse(request.body);
      await graphService.replaceTransitions(body.transitions);
      return { data: await graphService.listGraph() };
    },
  );

  // --- Return delivery methods (US6) --------------------------------------
  app.get('/api/v1/admin/returns/delivery-methods', { preHandler: requireAdmin('returns:read') }, async () => {
    return { data: await deliveryMethodService.list() };
  });

  app.post(
    '/api/v1/admin/returns/delivery-methods',
    { preHandler: requireAdmin('returns:write'), schema: { body: returnDeliveryMethodCreateSchema } },
    async (request, reply) => {
      const body = returnDeliveryMethodCreateSchema.parse(request.body);
      const data = await deliveryMethodService.create(body);
      reply.status(201);
      return { data };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/returns/delivery-methods/:id',
    { preHandler: requireAdmin('returns:write'), schema: { body: returnDeliveryMethodUpdateSchema } },
    async (request) => {
      const body = returnDeliveryMethodUpdateSchema.parse(request.body);
      const data = await deliveryMethodService.update(request.params.id, body);
      return { data };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/returns/delivery-methods/:id',
    { preHandler: requireAdmin('returns:write') },
    async (request) => {
      await deliveryMethodService.remove(request.params.id);
      return { data: { ok: true } };
    },
  );

  // --- Case detail + transitions (US2) ------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/returns/:id',
    { preHandler: requireAdmin('returns:read') },
    async (request) => {
      const data = await caseService.getByIdForAdmin(request.params.id);
      return { data };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/returns/:id/authorize',
    { preHandler: requireAdmin('returns:write') },
    async (request) => {
      const adminUserId = resolveAdminUserId(request);
      const data = await authorizationService.authorize(request.params.id, adminUserId);
      return { data };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/returns/:id/reject',
    { preHandler: requireAdmin('returns:write'), schema: { body: adminRejectRequestSchema } },
    async (request) => {
      const adminUserId = resolveAdminUserId(request);
      const body = adminRejectRequestSchema.parse(request.body);
      await authorizationService.reject(request.params.id, adminUserId, body.reason);
      return { data: await caseService.getByIdForAdmin(request.params.id) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/returns/:id/transition',
    { preHandler: requireAdmin('returns:write'), schema: { body: adminTransitionRequestSchema } },
    async (request) => {
      const adminUserId = resolveAdminUserId(request);
      const body = adminTransitionRequestSchema.parse(request.body);
      await transitions.apply(
        request.params.id,
        body.to,
        { kind: 'admin', adminUserId },
        body.reason !== undefined ? { reason: body.reason } : undefined,
      );
      return { data: await caseService.getByIdForAdmin(request.params.id) };
    },
  );

  // --- Settlement (US5) ----------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/returns/:id/settlement',
    { preHandler: requireAdmin('returns:read') },
    async (request) => {
      const data = await settlementService.getPrefill(request.params.id);
      return { data };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/returns/:id/settlement',
    { preHandler: requireAdmin('returns:write'), schema: { body: settlementRequestSchema } },
    async (request) => {
      const adminUserId = resolveAdminUserId(request);
      const body = settlementRequestSchema.parse(request.body);
      const data = await settlementService.settle(request.params.id, adminUserId, body);
      return { data };
    },
  );

  // --- Reasons (US7) -------------------------------------------------------
  app.get('/api/v1/admin/returns/reasons', { preHandler: requireAdmin('returns:read') }, async () => {
    return { data: await reasonService.listAll() };
  });

  app.post(
    '/api/v1/admin/returns/reasons',
    { preHandler: requireAdmin('returns:write'), schema: { body: returnReasonCreateSchema } },
    async (request, reply) => {
      const body = returnReasonCreateSchema.parse(request.body);
      const data = await reasonService.create(body);
      reply.status(201);
      return { data };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/returns/reasons/:id',
    { preHandler: requireAdmin('returns:write'), schema: { body: returnReasonUpdateSchema } },
    async (request) => {
      const body = returnReasonUpdateSchema.parse(request.body);
      const data = await reasonService.update(request.params.id, body);
      return { data };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/returns/reasons/:id',
    { preHandler: requireAdmin('returns:write') },
    async (request) => {
      await reasonService.remove(request.params.id);
      return { data: { ok: true } };
    },
  );

  // --- Return shipments (US6) ---------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/returns/:id/shipments',
    { preHandler: requireAdmin('returns:read') },
    async (request) => {
      return { data: await shipmentService.listForCase(request.params.id) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/returns/:id/shipments',
    { preHandler: requireAdmin('returns:write'), schema: { body: createReturnShipmentRequestSchema } },
    async (request, reply) => {
      const body = createReturnShipmentRequestSchema.parse(request.body);
      const data = await shipmentService.create(request.params.id, body);
      reply.status(201);
      return { data };
    },
  );

  app.post<{ Params: { id: string; shipmentId: string } }>(
    '/api/v1/admin/returns/:id/shipments/:shipmentId/receive',
    { preHandler: requireAdmin('returns:write') },
    async (request) => {
      const adminUserId = resolveAdminUserId(request);
      const data = await shipmentService.receive(request.params.id, request.params.shipmentId, adminUserId);
      return { data };
    },
  );

  // --- Comments (US4) ------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/returns/:id/comments',
    { preHandler: requireAdmin('returns:read') },
    async (request) => {
      const data = await commentService.listForAdmin(request.params.id);
      return { data };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/returns/:id/comments',
    { preHandler: requireAdmin('returns:write'), schema: { body: adminAddCommentRequestSchema } },
    async (request, reply) => {
      const adminUserId = resolveAdminUserId(request);
      const body = adminAddCommentRequestSchema.parse(request.body);
      const data = await commentService.addByAdmin(request.params.id, adminUserId, body);
      reply.status(201);
      return { data };
    },
  );
}
