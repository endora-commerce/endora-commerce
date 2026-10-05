import type { FastifyInstance } from 'fastify';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { WorkflowReadService } from '../services/workflow-read-service.js';

export interface WorkflowRoutesDeps {
  workflowReadService: WorkflowReadService;
  requireAdmin: RequireAdminFactory;
}

/**
 * The workflow configuration endpoints
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §4).
 *
 * `GET /workflow` is gated `crm:read`, not a configuration code: the list, the
 * board and the detail screen all need the statuses to render.
 */
export async function registerCrmWorkflowRoutes(
  app: FastifyInstance,
  deps: WorkflowRoutesDeps,
): Promise<void> {
  const { requireAdmin } = deps;

  app.get(
    '/api/v1/admin/crm/workflow',
    { preHandler: requireAdmin('crm:read') },
    async () => ({ data: await deps.workflowReadService.getWorkflow() }),
  );
}
