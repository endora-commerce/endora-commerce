import type { FastifyInstance } from 'fastify';
import { AssignOpportunityRequestSchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { OpportunityAssignmentService } from '../services/opportunity-assignment-service.js';
import type { OpportunityService } from '../services/opportunity-service.js';

export interface AssignmentRoutesDeps {
  assignmentService: OpportunityAssignmentService;
  opportunityService: OpportunityService;
  requireAdmin: RequireAdminFactory;
}

/**
 * Who holds an Opportunity
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §5).
 */
export async function registerCrmAssignmentRoutes(
  app: FastifyInstance,
  deps: AssignmentRoutesDeps,
): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id/assign',
    { preHandler: deps.requireAdmin('crm:write'), schema: { body: AssignOpportunityRequestSchema } },
    async (request) => {
      const body = AssignOpportunityRequestSchema.parse(request.body);
      await deps.assignmentService.assign(request.params.id, body.adminUserId);
      return { data: await deps.opportunityService.get(request.params.id) };
    },
  );
}
