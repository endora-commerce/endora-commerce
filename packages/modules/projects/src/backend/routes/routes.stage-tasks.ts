import type { FastifyInstance } from 'fastify';
import { SetProjectStageTasksBodySchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { StageTaskService } from '../services/stage-task-service.js';

export interface StageTaskRoutesDeps {
  stageTaskService: StageTaskService;
  requireAdmin: RequireAdminFactory;
}

const PROJECT = '/api/v1/admin/projects/:id';

/**
 * A Project's Stage Tasks and its Tasks (`contracts/admin-api.md` §2.2 –
 * §2.3; research R-7, R-8): the Stage Task definitions and the retry after a
 * failed creation are `projects:write`; the Tasks by Stage are `projects:read`
 * and answer `tasksAvailable: false` while the Tasks module is off. Every
 * route loads its Project through `ProjectAccess` first, so a Project the
 * caller may not see answers 404.
 */
export async function registerStageTaskRoutes(app: FastifyInstance, deps: StageTaskRoutesDeps): Promise<void> {
  const { requireAdmin, stageTaskService: stageTasks } = deps;

  app.put<{ Params: { id: string; stageId: string } }>(
    `${PROJECT}/stages/:stageId/tasks`,
    { preHandler: requireAdmin('projects:write'), schema: { body: SetProjectStageTasksBodySchema } },
    async (request) => {
      const body = SetProjectStageTasksBodySchema.parse(request.body);
      return { data: await stageTasks.setDefinitions(request.params.id, request.params.stageId, body.tasks, body.version) };
    },
  );

  app.post<{ Params: { id: string; stageId: string } }>(
    `${PROJECT}/stages/:stageId/materialize-tasks`,
    { preHandler: requireAdmin('projects:write') },
    async (request) => ({ data: await stageTasks.retry(request.params.id, request.params.stageId) }),
  );

  app.get<{ Params: { id: string } }>(
    `${PROJECT}/tasks`,
    { preHandler: requireAdmin('projects:read') },
    async (request) => ({
      data: await stageTasks.tasksByStage(request.params.id, await request.responseLanguage()),
    }),
  );
}
