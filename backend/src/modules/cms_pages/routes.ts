import type { FastifyInstance } from 'fastify';
import {
  upsertCmsPageRequestSchema,
  updateCmsPageRequestSchema,
} from '@b2b/contracts';
import type { CmsPageService } from './services/cms-page-service.js';
import type { CmsPage } from './entities/cms-page.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface CmsRoutesDeps {
  service: CmsPageService;
  requireAdmin: RequireAdminFactory;
}

const PATH_RE = /^[a-z0-9]+(?:[/\-][a-z0-9]+)*$/;

export async function registerCmsRoutes(
  app: FastifyInstance,
  deps: CmsRoutesDeps,
): Promise<void> {
  const { service, requireAdmin } = deps;

  // ---- Public read path ----
  app.get(
    '/api/v1/cms/pages/*',
    async (request, reply) => {
      const path = (request.params as { '*': string })['*'];
      if (!PATH_RE.test(path)) {
        reply.status(400);
        return { error: { code: 'VALIDATION_FAILED', message: 'invalid path' } };
      }
      const row = await service.getPublishedByPath(path);
      return { data: serialize(row) };
    },
  );

  // ---- Admin authoring ----
  app.get(
    '/api/v1/admin/cms/pages',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const rows = await service.list();
      return { data: rows.map(serialize) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/cms/pages/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const row = await service.getById(request.params.id);
      return { data: serialize(row) };
    },
  );

  app.post(
    '/api/v1/admin/cms/pages',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: upsertCmsPageRequestSchema },
    },
    async (request, reply) => {
      const body = upsertCmsPageRequestSchema.parse(request.body);
      const row = await service.create({
        path: body.path,
        title: body.title,
        body: body.body,
      });
      reply.status(201);
      return { data: serialize(row) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/cms/pages/:id',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: updateCmsPageRequestSchema },
    },
    async (request) => {
      const body = updateCmsPageRequestSchema.parse(request.body);
      const row = await service.update(request.params.id, {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
      });
      return { data: serialize(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/cms/pages/:id/publish',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const row = await service.publish(request.params.id);
      return { data: serialize(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/cms/pages/:id/unpublish',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const row = await service.unpublish(request.params.id);
      return { data: serialize(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/cms/pages/:id/archive',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const row = await service.archive(request.params.id);
      return { data: serialize(row) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/cms/pages/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await service.remove(request.params.id);
      reply.status(204).send();
    },
  );
}

function serialize(row: CmsPage): Record<string, unknown> {
  return {
    id: row.id,
    path: row.path,
    status: row.status,
    title: row.title,
    body: row.body,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
