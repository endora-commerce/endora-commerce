import type { FastifyInstance } from 'fastify';
import { CreateProjectLinkBodySchema, RecordProjectParamsSchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { LinkService } from '../services/link-service.js';
import type { RecordProjectService } from '../services/record-project-service.js';

export interface LinkRoutesDeps {
  linkService: LinkService;
  recordProjectService: RecordProjectService;
  requireAdmin: RequireAdminFactory;
}

/**
 * Linked records and the record panel
 * (`specs/163-projects-and-tasks/contracts/admin-api.md` §2.3).
 *
 * Reading a Project's links is `projects:read`; linking and unlinking
 * `projects:write`. The owner's read code of a kind — `orders:read`,
 * `rfqs:handle`, `crm:read`, `tasks:read` — is asked **by the services**, after
 * the owner's presence is decided, never as a route gate: `crm`,
 * `quote_requests` and `tasks` can be switched off, and a gate naming their
 * code would answer 403 where the contract says 503 (D-173). Removing a link
 * asks for nothing more — it shows nothing of the record.
 */
export async function registerLinkRoutes(app: FastifyInstance, deps: LinkRoutesDeps): Promise<void> {
  const { requireAdmin, linkService: links, recordProjectService: records } = deps;

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id/links',
    { preHandler: requireAdmin('projects:read') },
    async (request) => ({ data: await links.list(request.params.id, await request.responseLanguage()) }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id/links',
    { preHandler: requireAdmin('projects:write'), schema: { body: CreateProjectLinkBodySchema } },
    async (request, reply) => {
      const link = await links.add(
        request.params.id,
        CreateProjectLinkBodySchema.parse(request.body),
        await request.responseLanguage(),
      );
      reply.code(201);
      return { data: link };
    },
  );

  app.delete<{ Params: { id: string; linkId: string } }>(
    '/api/v1/admin/projects/:id/links/:linkId',
    { preHandler: requireAdmin('projects:write') },
    async (request, reply) => {
      await links.remove(request.params.id, request.params.linkId);
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/v1/admin/projects/records/:kind/:recordId/project',
    { preHandler: requireAdmin('projects:read') },
    async (request) => {
      const params = RecordProjectParamsSchema.parse(request.params);
      return { data: await records.projectOf(params.kind, params.recordId) };
    },
  );
}
