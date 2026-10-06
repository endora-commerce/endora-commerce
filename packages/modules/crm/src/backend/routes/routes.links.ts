import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CreateOpportunityLinkRequestSchema,
  UpdateOpportunityLinkRequestSchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { OpportunityLinkService } from '../services/opportunity-link-service.js';
import { ORDERS_READ_PERMISSION } from '../services/orders-permission.js';

export interface LinkRoutesDeps {
  linkService: OpportunityLinkService;
  requireAdmin: RequireAdminFactory;
}

/**
 * The documents linked to an Opportunity
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §3). All three
 * are `crm:write`; the links themselves are read as part of the Opportunity.
 *
 * **Linking an Order, and deciding whether it follows the Opportunity, also
 * ask for `orders:read`** (research N-R3): the answer shows the Order's number,
 * status and total, and a followed Order is one this Opportunity's transitions
 * move. Removing a link asks for nothing more — it shows nothing and moves
 * nothing.
 */
export async function registerCrmLinkRoutes(app: FastifyInstance, deps: LinkRoutesDeps): Promise<void> {
  const { requireAdmin, linkService: links } = deps;
  const requireOrdersRead = requireAdmin(ORDERS_READ_PERMISSION);
  /** Only an Order link is `orders`' business; any other kind is answered by the service. */
  const requireOrdersReadForAnOrder = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if ((request.body as { documentKind?: unknown } | null)?.documentKind !== 'order') return;
    await requireOrdersRead(request, reply);
  };

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id/links',
    {
      preHandler: [requireAdmin('crm:write'), requireOrdersReadForAnOrder],
      schema: { body: CreateOpportunityLinkRequestSchema },
    },
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
    {
      // Every link that can be followed is an Order's.
      preHandler: [requireAdmin('crm:write'), requireOrdersRead],
      schema: { body: UpdateOpportunityLinkRequestSchema },
    },
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
