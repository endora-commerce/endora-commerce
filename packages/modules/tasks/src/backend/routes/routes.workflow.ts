import type { FastifyInstance } from 'fastify';
import {
  CreateTaskStatusBodySchema,
  DeleteTaskStatusQuerySchema,
  ReorderTaskStatusesBodySchema,
  SetTaskTransitionsBodySchema,
  UpdateTaskStatusBodySchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { TaskService } from '../services/task-service.js';
import type { TaskWorkflowConfigService } from '../services/workflow-config-service.js';

export interface TaskWorkflowRoutesDeps {
  taskService: Pick<TaskService, 'workflow'>;
  workflowConfigService: Pick<
    TaskWorkflowConfigService,
    'createStatus' | 'updateStatus' | 'reorderStatuses' | 'deleteStatus' | 'setTransitions'
  >;
  requireAdmin: RequireAdminFactory;
}

const API = '/api/v1/admin/tasks';

/**
 * The Task workflow (`specs/165-task-management/contracts/admin-api.md` §4).
 *
 * `GET /tasks/workflow` is `tasks:read`: the status picker, the list's filter
 * and the board all need the statuses. Every write is `tasks:configure`
 * (FR-012) and answers the whole workflow as it stands afterwards, so a screen
 * never guesses what its change did to the rest.
 */
export async function registerTaskWorkflowRoutes(app: FastifyInstance, deps: TaskWorkflowRoutesDeps): Promise<void> {
  const { requireAdmin, workflowConfigService: config } = deps;
  const workflow = async () => ({ data: await deps.taskService.workflow() });

  app.get(`${API}/workflow`, { preHandler: requireAdmin('tasks:read') }, workflow);

  app.post(
    `${API}/statuses`,
    { preHandler: requireAdmin('tasks:configure'), schema: { body: CreateTaskStatusBodySchema } },
    async (request, reply) => {
      await config.createStatus(CreateTaskStatusBodySchema.parse(request.body));
      reply.code(201);
      return workflow();
    },
  );

  // Issue #1560 — the whole list in its new order, one Command.
  app.put(
    `${API}/statuses/order`,
    { preHandler: requireAdmin('tasks:configure'), schema: { body: ReorderTaskStatusesBodySchema } },
    async (request) => {
      await config.reorderStatuses(ReorderTaskStatusesBodySchema.parse(request.body));
      return workflow();
    },
  );

  app.patch<{ Params: { code: string } }>(
    `${API}/statuses/:code`,
    { preHandler: requireAdmin('tasks:configure'), schema: { body: UpdateTaskStatusBodySchema } },
    async (request) => {
      await config.updateStatus(request.params.code, UpdateTaskStatusBodySchema.parse(request.body));
      return workflow();
    },
  );

  app.delete<{ Params: { code: string } }>(
    `${API}/statuses/:code`,
    { preHandler: requireAdmin('tasks:configure'), schema: { querystring: DeleteTaskStatusQuerySchema } },
    async (request) => {
      const { replacement } = DeleteTaskStatusQuerySchema.parse(request.query ?? {});
      await config.deleteStatus(request.params.code, replacement, await request.responseLanguage());
      return workflow();
    },
  );

  app.put(
    `${API}/transitions`,
    { preHandler: requireAdmin('tasks:configure'), schema: { body: SetTaskTransitionsBodySchema } },
    async (request) => {
      await config.setTransitions(SetTaskTransitionsBodySchema.parse(request.body));
      return workflow();
    },
  );
}
