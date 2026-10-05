import type { FastifyInstance } from 'fastify';
import {
  CreateOpportunityStatusRequestSchema,
  SetOpportunityTransitionsRequestSchema,
  SetOrderStatusMappingsRequestSchema,
  UpdateOpportunityStatusRequestSchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { WorkflowConfigService } from '../services/workflow-config-service.js';
import type { WorkflowReadService } from '../services/workflow-read-service.js';

export interface WorkflowRoutesDeps {
  workflowReadService: WorkflowReadService;
  workflowConfigService: WorkflowConfigService;
  requireAdmin: RequireAdminFactory;
}

/**
 * The workflow configuration endpoints
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §4).
 *
 * `GET /workflow` is gated `crm:read`, not a configuration code: the list, the
 * board and the detail screen all need the statuses to render. Every write is
 * `crm:configure` and answers the whole workflow as it stands afterwards, so a
 * screen never has to guess what its change did to the rest.
 */
export async function registerCrmWorkflowRoutes(
  app: FastifyInstance,
  deps: WorkflowRoutesDeps,
): Promise<void> {
  const { requireAdmin, workflowConfigService: config } = deps;
  const workflow = async () => ({ data: await deps.workflowReadService.getWorkflow() });

  app.get('/api/v1/admin/crm/workflow', { preHandler: requireAdmin('crm:read') }, workflow);

  app.post(
    '/api/v1/admin/crm/statuses',
    {
      preHandler: requireAdmin('crm:configure'),
      schema: { body: CreateOpportunityStatusRequestSchema },
    },
    async (request, reply) => {
      await config.createStatus(CreateOpportunityStatusRequestSchema.parse(request.body));
      reply.code(201);
      return workflow();
    },
  );

  app.patch<{ Params: { code: string } }>(
    '/api/v1/admin/crm/statuses/:code',
    {
      preHandler: requireAdmin('crm:configure'),
      schema: { body: UpdateOpportunityStatusRequestSchema },
    },
    async (request) => {
      await config.updateStatus(
        request.params.code,
        UpdateOpportunityStatusRequestSchema.parse(request.body),
      );
      return workflow();
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/crm/statuses/:code',
    { preHandler: requireAdmin('crm:configure') },
    async (request, reply) => {
      await config.deleteStatus(request.params.code);
      return reply.code(204).send();
    },
  );

  app.put(
    '/api/v1/admin/crm/transitions',
    {
      preHandler: requireAdmin('crm:configure'),
      schema: { body: SetOpportunityTransitionsRequestSchema },
    },
    async (request) => {
      await config.setTransitions(SetOpportunityTransitionsRequestSchema.parse(request.body));
      return workflow();
    },
  );

  app.put(
    '/api/v1/admin/crm/order-status-mappings',
    {
      preHandler: requireAdmin('crm:configure'),
      schema: { body: SetOrderStatusMappingsRequestSchema },
    },
    async (request) => {
      await config.setOrderStatusMappings(SetOrderStatusMappingsRequestSchema.parse(request.body));
      return workflow();
    },
  );
}
