import type { FastifyInstance } from 'fastify';
import { createProjectSavedViewRequestSchema, updateProjectSavedViewRequestSchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { savedViewActor } from '../saved-view-actor.js';
import type { ProjectListViewService } from '../services/project-list-view-service.js';

export interface ProjectViewRoutesDeps {
  listViewService: ProjectListViewService;
  requireAdmin: RequireAdminFactory;
}

const VIEWS = '/api/v1/admin/projects/list-views';

/**
 * The saved views of the Projects list (issue #1734): feature 147's four
 * routes, every one `projects:read` — a view is the caller's own preset, so
 * reading Projects is all it takes to keep one. The static `list-views`
 * segment outranks `projects/:id` in Fastify's router. The actor comes from
 * the tenant context (`saved-view-actor.ts`).
 */
export async function registerProjectListViewRoutes(app: FastifyInstance, deps: ProjectViewRoutesDeps): Promise<void> {
  const { listViewService, requireAdmin } = deps;
  const guard = requireAdmin('projects:read');

  app.get(VIEWS, { preHandler: guard }, async () => ({ data: await listViewService.listFor(savedViewActor()) }));

  app.post(VIEWS, { preHandler: guard, schema: { body: createProjectSavedViewRequestSchema } }, async (request, reply) => {
    const view = await listViewService.create(savedViewActor(), createProjectSavedViewRequestSchema.parse(request.body));
    reply.code(201);
    return { data: view };
  });

  app.patch<{ Params: { id: string } }>(
    `${VIEWS}/:id`,
    { preHandler: guard, schema: { body: updateProjectSavedViewRequestSchema } },
    async (request) => ({
      data: await listViewService.update(
        request.params.id,
        savedViewActor(),
        updateProjectSavedViewRequestSchema.parse(request.body),
      ),
    }),
  );

  app.delete<{ Params: { id: string } }>(`${VIEWS}/:id`, { preHandler: guard }, async (request) => {
    await listViewService.remove(request.params.id, savedViewActor());
    return { data: { deleted: request.params.id } };
  });
}
