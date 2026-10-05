import type { FastifyInstance } from 'fastify';
import { OpportunityHistoryQuerySchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { OpportunityHistoryService } from '../services/opportunity-history-service.js';

export interface HistoryRoutesDeps {
  historyService: OpportunityHistoryService;
  requireAdmin: RequireAdminFactory;
}

/**
 * The change history of an Opportunity
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §11).
 *
 * `crm:read`, deliberately not `audit_log:read`: whoever may read an
 * Opportunity may read what happened to it.
 */
export async function registerCrmHistoryRoutes(app: FastifyInstance, deps: HistoryRoutesDeps): Promise<void> {
  const { requireAdmin, historyService } = deps;

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id/history',
    { preHandler: requireAdmin('crm:read') },
    async (request) => historyService.list(request.params.id, OpportunityHistoryQuerySchema.parse(request.query ?? {})),
  );
}
