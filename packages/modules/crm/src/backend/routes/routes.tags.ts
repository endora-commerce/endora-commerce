import type { FastifyInstance } from 'fastify';
import {
  CreateOpportunityTagRequestSchema,
  SetOpportunityTagsRequestSchema,
  UpdateOpportunityTagRequestSchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { OpportunityService } from '../services/opportunity-service.js';
import type { TagService } from '../services/tag-service.js';

export interface TagRoutesDeps {
  tagService: TagService;
  opportunityService: OpportunityService;
  requireAdmin: RequireAdminFactory;
}

/**
 * Tags (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §8).
 *
 * Reading the list is `crm:read`; managing it is `crm:configure` — it is
 * platform configuration; tagging an Opportunity is `crm:write`, a step of
 * daily work.
 */
export async function registerCrmTagRoutes(app: FastifyInstance, deps: TagRoutesDeps): Promise<void> {
  const { requireAdmin, tagService: tags } = deps;

  app.get('/api/v1/admin/crm/tags', { preHandler: requireAdmin('crm:read') }, async () => ({
    data: await tags.list(),
  }));

  app.post(
    '/api/v1/admin/crm/tags',
    { preHandler: requireAdmin('crm:configure'), schema: { body: CreateOpportunityTagRequestSchema } },
    async (request, reply) => {
      const tag = await tags.create(CreateOpportunityTagRequestSchema.parse(request.body));
      reply.code(201);
      return { data: tag };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/crm/tags/:id',
    { preHandler: requireAdmin('crm:configure'), schema: { body: UpdateOpportunityTagRequestSchema } },
    async (request) => ({
      data: await tags.update(request.params.id, UpdateOpportunityTagRequestSchema.parse(request.body)),
    }),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/crm/tags/:id',
    { preHandler: requireAdmin('crm:configure') },
    async (request, reply) => {
      await tags.delete(request.params.id);
      return reply.code(204).send();
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id/tags',
    { preHandler: requireAdmin('crm:write'), schema: { body: SetOpportunityTagsRequestSchema } },
    async (request) => {
      const body = SetOpportunityTagsRequestSchema.parse(request.body);
      return { data: await deps.opportunityService.setTags(request.params.id, body.tagIds) };
    },
  );
}
