import type { FastifyInstance } from 'fastify';
import {
  createCmsPageRequestSchema,
  patchCmsPageRequestSchema,
  putCmsPageContentRequestSchema,
} from '@b2b/contracts';
import type { RequireAdminFactory } from './plugin.js';
import type { CmsPageService } from './services/cms-page-service.js';
import type { PageBuilderRegistry } from './services/page-builder-registry.js';

export async function registerCmsAdminRoutes(
  app: FastifyInstance,
  deps: {
    pageService: CmsPageService;
    pageBuilderRegistry: PageBuilderRegistry;
    requireAdmin?: RequireAdminFactory;
  },
): Promise<void> {
  const requireRead = deps.requireAdmin?.('cms.read') ?? (async () => {});
  const requireWrite = deps.requireAdmin?.('cms.write') ?? (async () => {});

  app.get('/api/v1/admin/cms/pages', { preHandler: requireRead }, async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return deps.pageService.list({
      ...(query['salesChannelId'] ? { salesChannelId: query['salesChannelId'] } : {}),
      ...(query['status'] ? { status: query['status'] } : {}),
      ...(query['q'] ? { q: query['q'] } : {}),
    });
  });

  app.get('/api/v1/admin/cms/page-builder/config', { preHandler: requireRead }, async () => ({
    data: deps.pageBuilderRegistry.describe(),
  }));

  app.post('/api/v1/admin/cms/pages', { preHandler: requireWrite }, async (request, reply) => {
    const body = createCmsPageRequestSchema.parse(request.body);
    const page = await deps.pageService.create(body);
    return reply.code(201).send({ data: page });
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/cms/pages/:id',
    { preHandler: requireRead },
    async (request) => ({ data: await deps.pageService.get(request.params.id) }),
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/cms/pages/:id',
    { preHandler: requireWrite },
    async (request) => {
      const body = patchCmsPageRequestSchema.parse(request.body);
      return { data: await deps.pageService.patch(request.params.id, body) };
    },
  );

  app.put<{ Params: { id: string; language: string } }>(
    '/api/v1/admin/cms/pages/:id/content/:language',
    { preHandler: requireWrite },
    async (request) => {
      const body = putCmsPageContentRequestSchema.parse(request.body);
      return {
        data: await deps.pageService.setContent(
          request.params.id,
          request.params.language,
          body.data,
          body.version,
        ),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/cms/pages/:id/publish',
    { preHandler: requireWrite },
    async (request) => ({ data: await deps.pageService.publish(request.params.id) }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/cms/pages/:id/archive',
    { preHandler: requireWrite },
    async (request) => ({ data: await deps.pageService.archive(request.params.id) }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/cms/pages/:id/unarchive',
    { preHandler: requireWrite },
    async (request) => ({ data: await deps.pageService.unarchive(request.params.id) }),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/cms/pages/:id',
    { preHandler: requireWrite },
    async (request, reply) => {
      await deps.pageService.delete(request.params.id);
      return reply.code(204).send();
    },
  );
}
