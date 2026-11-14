import type { FastifyInstance } from 'fastify';
import {
  CreateProjectBodySchema,
  ERROR_CODES,
  isCustomFieldFilterUnavailableFailure,
  ProjectDictionaryListQuerySchema,
  ProjectListQuerySchema,
  SetProjectMembersBodySchema,
  SetProjectOrganizationsBodySchema,
  UpdateProjectBodySchema,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { ProjectReadService } from '../services/project-read-service.js';
import type { ProjectService } from '../services/project-service.js';

export interface ProjectRoutesDeps {
  projectReadService: ProjectReadService;
  projectService: ProjectService;
  requireAdmin: RequireAdminFactory;
}

/**
 * Projects (`specs/163-projects-and-tasks/contracts/admin-api.md` §2.1) and
 * the two dictionaries their forms offer (§2.5 reads). Reading is
 * `projects:read`; creating, editing and deleting `projects:write`. A Project
 * out of the caller's Organization reach, or invisible to them, answers 404
 * `PROJECT_NOT_FOUND`, the same as a missing one, and is absent from the list
 * and its total.
 */
export async function registerProjectRoutes(app: FastifyInstance, deps: ProjectRoutesDeps): Promise<void> {
  const { requireAdmin, projectReadService: read, projectService: projects } = deps;

  app.get('/api/v1/admin/projects', { preHandler: requireAdmin('projects:read') }, async (request) =>
    read.list(ProjectListQuerySchema.parse(request.query ?? {})).catch((error: unknown) => {
      // A custom field the list does not offer is the caller's mistake: 400,
      // naming it (User Story 9). Everything else is rethrown untouched.
      if (isCustomFieldFilterUnavailableFailure(error)) {
        throw new HttpError(400, ERROR_CODES.CUSTOM_FIELD_FILTER_UNAVAILABLE, error.message, {
          key: error.keys[0] ?? '',
          keys: [...error.keys],
        });
      }
      throw error;
    }),
  );

  // The custom fields the list offers as filters (User Story 9; `specs/157-custom-fields-list-filters/`).
  app.get('/api/v1/admin/projects/custom-field-filters', { preHandler: requireAdmin('projects:read') }, async () => ({
    data: await read.customFieldFilterFields(),
  }));

  app.get('/api/v1/admin/projects/roles', { preHandler: requireAdmin('projects:read') }, async (request) => {
    const query = ProjectDictionaryListQuerySchema.parse(request.query ?? {});
    return { data: await read.roles(query.active === 'true', await request.responseLanguage()) };
  });

  app.get('/api/v1/admin/projects/loss-reasons', { preHandler: requireAdmin('projects:read') }, async (request) => {
    const query = ProjectDictionaryListQuerySchema.parse(request.query ?? {});
    return { data: await read.lossReasons(query.active === 'true', await request.responseLanguage()) };
  });

  app.post(
    '/api/v1/admin/projects',
    { preHandler: requireAdmin('projects:write'), schema: { body: CreateProjectBodySchema } },
    async (request, reply) => {
      const created = await projects.create(CreateProjectBodySchema.parse(request.body), await request.responseLanguage());
      reply.code(201);
      return { data: created };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id',
    { preHandler: requireAdmin('projects:read') },
    async (request) => ({ data: await read.get(request.params.id, await request.responseLanguage()) }),
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id',
    { preHandler: requireAdmin('projects:write'), schema: { body: UpdateProjectBodySchema } },
    async (request) => ({
      data: await projects.update(
        request.params.id,
        UpdateProjectBodySchema.parse(request.body),
        await request.responseLanguage(),
      ),
    }),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id',
    { preHandler: requireAdmin('projects:write') },
    async (request, reply) => {
      await projects.delete(request.params.id);
      return reply.code(204).send();
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id/organizations',
    { preHandler: requireAdmin('projects:write'), schema: { body: SetProjectOrganizationsBodySchema } },
    async (request) => {
      const body = SetProjectOrganizationsBodySchema.parse(request.body);
      return { data: await projects.setOrganizations(request.params.id, body.organizationIds, await request.responseLanguage(), body.configurationVersion) };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id/members',
    { preHandler: requireAdmin('projects:write'), schema: { body: SetProjectMembersBodySchema } },
    async (request) => {
      const body = SetProjectMembersBodySchema.parse(request.body);
      return { data: await projects.setMembers(request.params.id, body.members, await request.responseLanguage(), body.configurationVersion) };
    },
  );
}
