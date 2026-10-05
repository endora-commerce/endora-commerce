import type { FastifyInstance } from 'fastify';
import {
  CreateOpportunityLinkRequestSchema,
  UpdateOpportunityLinkRequestSchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { OpportunityLinkService } from '../services/opportunity-link-service.js';

export interface LinkRoutesDeps {
  linkService: OpportunityLinkService;
  requireAdmin: RequireAdminFactory;
}

/**
 * The documents linked to an Opportunity
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §3). All three
 * are `crm:write`; the links themselves are read as part of the Opportunity.
 */
export async function registerCrmLinkRoutes(app: FastifyInstance, deps: LinkRoutesDeps): Promise<void> {
  const { requireAdmin, linkService: links } = deps;

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id/links',
    { preHandler: requireAdmin('crm:write'), schema: { body: CreateOpportunityLinkRequestSchema } },
    async (request, reply) => {
      const link = await links.add(
        request.params.id,
        CreateOpportunityLinkRequestSchema.parse(request.body),
      );
      reply.code(201);
      return { data: link };
    },
  );

  app.patch<{ Params: { id: string; linkId: string } }>(
    '/api/v1/admin/crm/opportunities/:id/links/:linkId',
    { preHandler: requireAdmin('crm:write'), schema: { body: UpdateOpportunityLinkRequestSchema } },
    async (request) => {
      const body = UpdateOpportunityLinkRequestSchema.parse(request.body);
      return {
        data: await links.setSyncStatus(request.params.id, request.params.linkId, body.syncStatus),
      };
    },
  );

  app.delete<{ Params: { id: string; linkId: string } }>(
    '/api/v1/admin/crm/opportunities/:id/links/:linkId',
    { preHandler: requireAdmin('crm:write') },
    async (request, reply) => {
      await links.remove(request.params.id, request.params.linkId);
      return reply.code(204).send();
    },
  );
}
