import type { FastifyInstance } from 'fastify';
import {
  CreateTaskPriorityBodySchema,
  DeleteTaskPriorityQuerySchema,
  ReorderTaskPrioritiesBodySchema,
  UpdateTaskPriorityBodySchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { TaskPriorityService } from '../services/priority-service.js';

export interface TaskPriorityRoutesDeps {
  priorityService: Pick<TaskPriorityService, 'list' | 'create' | 'update' | 'reorder' | 'delete'>;
  requireAdmin: RequireAdminFactory;
}

const API = '/api/v1/admin/tasks';

/**
 * The priority list (`specs/165-task-management/contracts/admin-api.md` §4):
 * read by every holder of `tasks:read`, so the picker and the filter offer it;
 * every write is `tasks:configure` (FR-041) and answers the whole list as it
 * stands afterwards — the workflow's shape.
 */
export async function registerTaskPriorityRoutes(app: FastifyInstance, deps: TaskPriorityRoutesDeps): Promise<void> {
  const { requireAdmin, priorityService } = deps;

  app.get(`${API}/priorities`, { preHandler: requireAdmin('tasks:read') }, async () => ({
    data: await priorityService.list(),
  }));

  app.post(
    `${API}/priorities`,
    { preHandler: requireAdmin('tasks:configure'), schema: { body: CreateTaskPriorityBodySchema } },
    async (request, reply) => {
      const data = await priorityService.create(CreateTaskPriorityBodySchema.parse(request.body));
      reply.code(201);
      return { data };
    },
  );

  // Issue #1560 — the whole list in its new order, one Command.
  app.put(
    `${API}/priorities/order`,
    { preHandler: requireAdmin('tasks:configure'), schema: { body: ReorderTaskPrioritiesBodySchema } },
    async (request) => ({ data: await priorityService.reorder(ReorderTaskPrioritiesBodySchema.parse(request.body)) }),
  );

  app.patch<{ Params: { code: string } }>(
    `${API}/priorities/:code`,
    { preHandler: requireAdmin('tasks:configure'), schema: { body: UpdateTaskPriorityBodySchema } },
    async (request) => ({
      data: await priorityService.update(request.params.code, UpdateTaskPriorityBodySchema.parse(request.body)),
    }),
  );

  app.delete<{ Params: { code: string } }>(
    `${API}/priorities/:code`,
    { preHandler: requireAdmin('tasks:configure'), schema: { querystring: DeleteTaskPriorityQuerySchema } },
    async (request) => {
      const { replacement } = DeleteTaskPriorityQuerySchema.parse(request.query ?? {});
      return { data: await priorityService.delete(request.params.code, replacement) };
    },
  );
}
