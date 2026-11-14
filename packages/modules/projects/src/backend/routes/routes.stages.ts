import type { FastifyInstance } from 'fastify';
import {
  CloseProjectBodySchema,
  CreateProjectStageBodySchema,
  MoveProjectBodySchema,
  ReopenProjectBodySchema,
  ReorderProjectStagesBodySchema,
  SetProjectMovesBodySchema,
  UpdateProjectStageBodySchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { MoveService } from '../services/move-service.js';
import type { ProjectReadService } from '../services/project-read-service.js';
import type { StageService } from '../services/stage-service.js';

export interface StageRoutesDeps {
  projectReadService: ProjectReadService;
  stageService: StageService;
  moveService: MoveService;
  requireAdmin: RequireAdminFactory;
}

const PROJECT = '/api/v1/admin/projects/:id';

/**
 * A Project's Stages, its workflow, and walking it
 * (`specs/163-projects-and-tasks/contracts/admin-api.md` §2.2). Changing
 * Stages and moves, moving, closing and reopening are `projects:write`; the
 * Stage history is `projects:read`. Every route loads its Project through
 * `ProjectAccess` first, so a Project the caller may not see answers 404.
 *
 * Stage Task definitions (`PUT …/stages/:stageId/tasks`), their retry
 * (`POST …/materialize-tasks`) and the Tasks by Stage are in
 * `routes.stage-tasks.ts`.
 */
export async function registerStageRoutes(app: FastifyInstance, deps: StageRoutesDeps): Promise<void> {
  const { requireAdmin, projectReadService: read, stageService: stages, moveService: moves } = deps;

  app.post<{ Params: { id: string } }>(
    `${PROJECT}/stages`,
    { preHandler: requireAdmin('projects:write'), schema: { body: CreateProjectStageBodySchema } },
    async (request, reply) => {
      const created = await stages.create(request.params.id, CreateProjectStageBodySchema.parse(request.body));
      reply.code(201);
      return { data: created };
    },
  );

  // Before `/stages/:stageId`'s siblings so `order` is never read as an id.
  app.put<{ Params: { id: string } }>(
    `${PROJECT}/stages/order`,
    { preHandler: requireAdmin('projects:write'), schema: { body: ReorderProjectStagesBodySchema } },
    async (request) => {
      const body = ReorderProjectStagesBodySchema.parse(request.body);
      return { data: await stages.reorder(request.params.id, body.stageIds, await request.responseLanguage(), body.configurationVersion) };
    },
  );

  app.patch<{ Params: { id: string; stageId: string } }>(
    `${PROJECT}/stages/:stageId`,
    { preHandler: requireAdmin('projects:write'), schema: { body: UpdateProjectStageBodySchema } },
    async (request) => ({
      data: await stages.update(
        request.params.id,
        request.params.stageId,
        UpdateProjectStageBodySchema.parse(request.body),
      ),
    }),
  );

  app.delete<{ Params: { id: string; stageId: string } }>(
    `${PROJECT}/stages/:stageId`,
    { preHandler: requireAdmin('projects:write') },
    async (request, reply) => {
      await stages.delete(request.params.id, request.params.stageId);
      return reply.code(204).send();
    },
  );

  app.put<{ Params: { id: string } }>(
    `${PROJECT}/moves`,
    { preHandler: requireAdmin('projects:write'), schema: { body: SetProjectMovesBodySchema } },
    async (request) => {
      const body = SetProjectMovesBodySchema.parse(request.body);
      return { data: await stages.setMoves(request.params.id, body.moves, body.configurationVersion) };
    },
  );

  app.post<{ Params: { id: string } }>(
    `${PROJECT}/move`,
    { preHandler: requireAdmin('projects:write'), schema: { body: MoveProjectBodySchema } },
    async (request) => ({
      data: await moves.move(request.params.id, MoveProjectBodySchema.parse(request.body), await request.responseLanguage()),
    }),
  );

  app.post<{ Params: { id: string } }>(
    `${PROJECT}/close`,
    { preHandler: requireAdmin('projects:write'), schema: { body: CloseProjectBodySchema } },
    async (request) => ({
      data: await moves.close(request.params.id, CloseProjectBodySchema.parse(request.body), await request.responseLanguage()),
    }),
  );

  app.post<{ Params: { id: string } }>(
    `${PROJECT}/reopen`,
    { preHandler: requireAdmin('projects:write'), schema: { body: ReopenProjectBodySchema } },
    async (request) => ({
      data: await moves.reopen(request.params.id, ReopenProjectBodySchema.parse(request.body), await request.responseLanguage()),
    }),
  );

  app.get<{ Params: { id: string } }>(
    `${PROJECT}/stage-history`,
    { preHandler: requireAdmin('projects:read') },
    async (request) => ({ data: await read.stageHistory(request.params.id) }),
  );
}
