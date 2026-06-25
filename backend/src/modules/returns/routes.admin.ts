import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  adminAddCommentRequestSchema,
  adminRejectRequestSchema,
  adminTransitionRequestSchema,
  returnStatusCreateSchema,
  returnStatusUpdateSchema,
  returnTransitionsSetSchema,
  settlementRequestSchema,
} from '@b2b/contracts';
import type { ReturnCaseService } from './services/return-case-service.js';
import type { ReturnAuthorizationService } from './services/return-authorization-service.js';
import type { ReturnCommentService } from './services/return-comment-service.js';
import type { ReturnSettlementService } from './services/return-settlement-service.js';
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
    transitions,
    graphService,
    requireAdmin,
    resolveAdminUserId,
  } = deps;

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
