import type { FastifyInstance } from 'fastify';
import {
  CreateOpportunityCommentRequestSchema,
  OpportunityCommentListQuerySchema,
  UpdateOpportunityCommentRequestSchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { OpportunityCommentService } from '../services/opportunity-comment-service.js';

export interface CommentRoutesDeps {
  commentService: OpportunityCommentService;
  requireAdmin: RequireAdminFactory;
}

/**
 * Notes and internal messages
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §6).
 *
 * `crm:write` lets somebody write; it does not let them change what somebody
 * else wrote. That rule is the service's: a note is edited and deleted by its
 * author only (403), and a message by nobody (409 `CRM_MESSAGE_IMMUTABLE`).
 */
export async function registerCrmCommentRoutes(app: FastifyInstance, deps: CommentRoutesDeps): Promise<void> {
  const { requireAdmin, commentService: comments } = deps;

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id/comments',
    { preHandler: requireAdmin('crm:read') },
    async (request) => {
      const query = OpportunityCommentListQuerySchema.parse(request.query ?? {});
      return { data: await comments.list(request.params.id, query.kind) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id/comments',
    { preHandler: requireAdmin('crm:write'), schema: { body: CreateOpportunityCommentRequestSchema } },
    async (request, reply) => {
      const comment = await comments.add(
        request.params.id,
        CreateOpportunityCommentRequestSchema.parse(request.body),
      );
      reply.code(201);
      return { data: comment };
    },
  );

  app.patch<{ Params: { id: string; commentId: string } }>(
    '/api/v1/admin/crm/opportunities/:id/comments/:commentId',
    { preHandler: requireAdmin('crm:write'), schema: { body: UpdateOpportunityCommentRequestSchema } },
    async (request) => {
      const body = UpdateOpportunityCommentRequestSchema.parse(request.body);
      return {
        data: await comments.update(request.params.id, request.params.commentId, body.body),
      };
    },
  );

  app.delete<{ Params: { id: string; commentId: string } }>(
    '/api/v1/admin/crm/opportunities/:id/comments/:commentId',
    { preHandler: requireAdmin('crm:write') },
    async (request, reply) => {
      await comments.delete(request.params.id, request.params.commentId);
      return reply.code(204).send();
    },
  );
}
