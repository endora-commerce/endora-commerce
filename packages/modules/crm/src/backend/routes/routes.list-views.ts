import type { FastifyInstance } from 'fastify';
import { createOpportunitySavedViewRequestSchema, updateOpportunitySavedViewRequestSchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { savedViewActor } from '../saved-view-actor.js';
import type { OpportunityListViewService } from '../services/opportunity-list-view-service.js';

export interface OpportunityViewRoutesDeps {
  listViewService: OpportunityListViewService;
  requireAdmin: RequireAdminFactory;
}

const VIEWS = '/api/v1/admin/crm/opportunities/list-views';

/**
 * The saved views of the Opportunities page (issue #1734): feature 147's four
 * routes, every one `crm:read` — a view is the caller's own preset, so reading
 * Opportunities is all it takes to keep one. The static `list-views` segment
 * outranks `opportunities/:id` in Fastify's router. The actor comes from the
 * tenant context (`saved-view-actor.ts`).
 */
export async function registerCrmListViewRoutes(app: FastifyInstance, deps: OpportunityViewRoutesDeps): Promise<void> {
  const { listViewService, requireAdmin } = deps;
  const guard = requireAdmin('crm:read');

  app.get(VIEWS, { preHandler: guard }, async () => ({ data: await listViewService.listFor(savedViewActor()) }));

  app.post(VIEWS, { preHandler: guard, schema: { body: createOpportunitySavedViewRequestSchema } }, async (request, reply) => {
    const view = await listViewService.create(savedViewActor(), createOpportunitySavedViewRequestSchema.parse(request.body));
    reply.code(201);
    return { data: view };
  });

  app.patch<{ Params: { id: string } }>(
    `${VIEWS}/:id`,
    { preHandler: guard, schema: { body: updateOpportunitySavedViewRequestSchema } },
    async (request) => ({
      data: await listViewService.update(
        request.params.id,
        savedViewActor(),
        updateOpportunitySavedViewRequestSchema.parse(request.body),
      ),
    }),
  );

  app.delete<{ Params: { id: string } }>(`${VIEWS}/:id`, { preHandler: guard }, async (request) => {
    await listViewService.remove(request.params.id, savedViewActor());
    return { data: { deleted: request.params.id } };
  });
}
