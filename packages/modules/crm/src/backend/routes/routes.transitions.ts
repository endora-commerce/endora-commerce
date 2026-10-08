import type { FastifyInstance } from 'fastify';
import {
  TransitionOpportunityRequestSchema,
  type OpportunityTransitionResult,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { OpportunityService } from '../services/opportunity-service.js';
import type { OpportunityTransitionService } from '../services/opportunity-transition-service.js';
import type { OrderStatusPropagationService } from '../services/order-status-propagation-service.js';

export interface TransitionRoutesDeps {
  transitionService: OpportunityTransitionService;
  propagationService: OrderStatusPropagationService;
  opportunityService: OpportunityService;
  requireAdmin: RequireAdminFactory;
}

/**
 * Moving an Opportunity, and what became of its Orders
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §2).
 *
 * **A refused Order change is not an HTTP error.** The Opportunity moved; the
 * response is 200 and the refusal is an element of `propagation`, which *Retry*
 * and *Dismiss* then address by id.
 */
export async function registerCrmTransitionRoutes(
  app: FastifyInstance,
  deps: TransitionRoutesDeps,
): Promise<void> {
  const { requireAdmin } = deps;

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id/transition',
    { preHandler: requireAdmin('crm:write'), schema: { body: TransitionOpportunityRequestSchema } },
    async (request) => {
      const body = TransitionOpportunityRequestSchema.parse(request.body);
      const applied = await deps.transitionService.apply(request.params.id, body.to, {
        reason: body.reason,
      });
      // Read after everything committed, so the detail carries the Orders as
      // they now are and any refusal among the unresolved outcomes.
      const result: OpportunityTransitionResult = {
        opportunity: await deps.opportunityService.get(applied.opportunityId),
        from: applied.from,
        to: applied.to,
        propagation: applied.propagation,
      };
      return { data: result };
    },
  );

  app.post<{ Params: { id: string; propagationId: string } }>(
    '/api/v1/admin/crm/opportunities/:id/propagations/:propagationId/retry',
    { preHandler: requireAdmin('crm:write') },
    async (request) => ({
      data: await deps.propagationService.retry(request.params.id, request.params.propagationId),
    }),
  );

  app.post<{ Params: { id: string; propagationId: string } }>(
    '/api/v1/admin/crm/opportunities/:id/propagations/:propagationId/dismiss',
    { preHandler: requireAdmin('crm:write') },
    async (request, reply) => {
      await deps.propagationService.dismiss(request.params.id, request.params.propagationId);
      return reply.code(204).send();
    },
  );
}
