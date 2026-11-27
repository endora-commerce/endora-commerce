import type { FastifyInstance } from 'fastify';
import {
  CreateProjectCommentBodySchema,
  MarkProjectMessagesReadBodySchema,
  ProjectCommentListQuerySchema,
  UpdateProjectCommentBodySchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { ProjectCommentService } from '../services/comment-service.js';

export interface CommentRoutesDeps {
  commentService: ProjectCommentService;
  requireAdmin: RequireAdminFactory;
}

/**
 * Notes and the message thread of a Project
 * (`specs/163-projects-and-tasks/contracts/admin-api.md` §2.4).
 *
 * `projects:write` lets somebody write; it does not let them change what
 * somebody else wrote — that rule is the service's: a note is edited and
 * deleted by its author only (403 `PROJECT_NOTE_NOT_AUTHOR`), a message by
 * nobody (409 `PROJECT_MESSAGE_IMMUTABLE`). Marking the thread read is
 * `projects:read`: it moves the reader's own marker and changes nothing about
 * the Project.
 */
export async function registerCommentRoutes(app: FastifyInstance, deps: CommentRoutesDeps): Promise<void> {
  const { requireAdmin, commentService: comments } = deps;

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id/comments',
    { preHandler: requireAdmin('projects:read') },
    async (request) => {
      const query = ProjectCommentListQuerySchema.parse(request.query ?? {});
      return { data: await comments.list(request.params.id, query.kind) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id/comments',
    {
      preHandler: requireAdmin('projects:write'),
      schema: { body: CreateProjectCommentBodySchema },
    },
    async (request, reply) => {
      const comment = await comments.add(request.params.id, CreateProjectCommentBodySchema.parse(request.body));
      reply.code(201);
      return { data: comment };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id/messages/read',
    {
      preHandler: requireAdmin('projects:read'),
      schema: { body: MarkProjectMessagesReadBodySchema },
    },
    async (request) => {
      const body = MarkProjectMessagesReadBodySchema.parse(request.body);
      return { data: await comments.markMessagesRead(request.params.id, body.throughMessageId) };
    },
  );

  app.patch<{ Params: { id: string; commentId: string } }>(
    '/api/v1/admin/projects/:id/comments/:commentId',
    {
      preHandler: requireAdmin('projects:write'),
      schema: { body: UpdateProjectCommentBodySchema },
    },
    async (request) => {
      const body = UpdateProjectCommentBodySchema.parse(request.body);
      return {
        data: await comments.update(request.params.id, request.params.commentId, body.body, body.customFieldValues),
      };
    },
  );

  app.delete<{ Params: { id: string; commentId: string } }>(
    '/api/v1/admin/projects/:id/comments/:commentId',
    { preHandler: requireAdmin('projects:write') },
    async (request, reply) => {
      await comments.delete(request.params.id, request.params.commentId);
      return reply.code(204).send();
    },
  );
}
