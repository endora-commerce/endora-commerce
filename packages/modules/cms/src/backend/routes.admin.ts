import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  createCmsBlockRequestSchema,
  createCmsHookRequestSchema,
  createCmsPageRequestSchema,
  createCmsTemplateRequestSchema,
  cmsHookAttachmentRequestSchema,
  patchCmsBlockRequestSchema,
  patchCmsHookRequestSchema,
  patchCmsPageRequestSchema,
  patchCmsTemplateRequestSchema,
  putCmsColorPaletteRequestSchema,
  putCmsPageContentRequestSchema,
} from '@endora-commerce/contracts';
import type { ColorPaletteAuditContext, ColorPaletteWriter } from './plugin.js';
import type { CmsPageService } from './services/cms-page-service.js';
import type { PageBuilderRegistry } from './services/page-builder-registry.js';
import type { CmsBlockService } from './services/cms-block-service.js';
import type { CmsHookService } from './services/cms-hook-service.js';
import type { CmsTemplateService } from './services/cms-template-service.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

export async function registerCmsAdminRoutes(
  app: FastifyInstance,
  deps: {
    pageService: CmsPageService;
    blockService: CmsBlockService;
    hookService: CmsHookService;
    templateService: CmsTemplateService;
    pageBuilderRegistry: PageBuilderRegistry;
    getColorPaletteWriter?: () => ColorPaletteWriter | null;
    resolveAdminAuditContext?: (req: FastifyRequest) => ColorPaletteAuditContext;
    requireAdmin: RequireAdminFactory;
  },
): Promise<void> {
  const requireRead = deps.requireAdmin('cms.read');
  const requireWrite = deps.requireAdmin('cms.write');

  app.get('/api/v1/admin/cms/pages', { preHandler: requireRead }, async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return deps.pageService.list({
      ...(query['salesChannelId'] ? { salesChannelId: query['salesChannelId'] } : {}),
      ...(query['status'] ? { status: query['status'] } : {}),
      ...(query['q'] ? { q: query['q'] } : {}),
    });
  });

  app.get('/api/v1/admin/cms/page-builder/config', { preHandler: requireRead }, async () => ({
    data: await deps.pageBuilderRegistry.describe(),
  }));

  app.put('/api/v1/admin/cms/page-builder/color-palette', { preHandler: requireWrite }, async (request) => {
    const writer = deps.getColorPaletteWriter?.();
    if (!writer) {
      throw new Error('Color palette writer is not configured.');
    }
    const body = putCmsColorPaletteRequestSchema.parse(request.body);
    const rid = request.headers['x-request-id'];
    const actor =
      deps.resolveAdminAuditContext?.(request) ?? {
        actorAdminUserId: null,
        requestId: typeof rid === 'string' ? rid : null,
      };
    const entries = await writer(body.entries, body.expectedVersion ?? null, actor);
    return { data: { entries } };
  });

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

  app.get('/api/v1/admin/cms/blocks', { preHandler: requireRead }, async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return deps.blockService.list({
      ...(query['salesChannelId'] ? { salesChannelId: query['salesChannelId'] } : {}),
    });
  });

  app.post('/api/v1/admin/cms/blocks', { preHandler: requireWrite }, async (request, reply) => {
    const body = createCmsBlockRequestSchema.parse(request.body);
    const block = await deps.blockService.create(body);
    return reply.code(201).send({ data: block });
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/cms/blocks/:id',
    { preHandler: requireRead },
    async (request) => ({ data: await deps.blockService.get(request.params.id) }),
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/cms/blocks/:id',
    { preHandler: requireWrite },
    async (request) => {
      const body = patchCmsBlockRequestSchema.parse(request.body);
      return { data: await deps.blockService.patch(request.params.id, body) };
    },
  );

  app.put<{ Params: { id: string; language: string } }>(
    '/api/v1/admin/cms/blocks/:id/content/:language',
    { preHandler: requireWrite },
    async (request) => {
      const body = putCmsPageContentRequestSchema.parse(request.body);
      return {
        data: await deps.blockService.setContent(
          request.params.id,
          request.params.language,
          body.data,
          body.version,
        ),
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/cms/blocks/:id',
    { preHandler: requireWrite },
    async (request, reply) => {
      await deps.blockService.delete(request.params.id);
      return reply.code(204).send();
    },
  );

  app.get('/api/v1/admin/cms/templates', { preHandler: requireRead }, async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return deps.templateService.list({
      ...(query['salesChannelId'] ? { salesChannelId: query['salesChannelId'] } : {}),
    });
  });

  app.post('/api/v1/admin/cms/templates', { preHandler: requireWrite }, async (request, reply) => {
    const body = createCmsTemplateRequestSchema.parse(request.body);
    const template = await deps.templateService.create(body);
    return reply.code(201).send({ data: template });
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/cms/templates/:id',
    { preHandler: requireRead },
    async (request) => ({ data: await deps.templateService.get(request.params.id) }),
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/cms/templates/:id',
    { preHandler: requireWrite },
    async (request) => {
      const body = patchCmsTemplateRequestSchema.parse(request.body);
      return { data: await deps.templateService.patch(request.params.id, body) };
    },
  );

  app.put<{ Params: { id: string; language: string } }>(
    '/api/v1/admin/cms/templates/:id/content/:language',
    { preHandler: requireWrite },
    async (request) => {
      const body = putCmsPageContentRequestSchema.parse(request.body);
      return {
        data: await deps.templateService.setContent(
          request.params.id,
          request.params.language,
          body.data,
          body.version,
        ),
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/cms/templates/:id',
    { preHandler: requireWrite },
    async (request, reply) => {
      await deps.templateService.delete(request.params.id);
      return reply.code(204).send();
    },
  );

  app.get('/api/v1/admin/cms/hooks', { preHandler: requireRead }, async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return deps.hookService.list({
      ...(query['salesChannelId'] ? { salesChannelId: query['salesChannelId'] } : {}),
    });
  });

  app.post('/api/v1/admin/cms/hooks', { preHandler: requireWrite }, async (request, reply) => {
    const body = createCmsHookRequestSchema.parse(request.body);
    const hook = await deps.hookService.create(body);
    return reply.code(201).send({ data: hook });
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/cms/hooks/:id',
    { preHandler: requireRead },
    async (request) => ({ data: await deps.hookService.get(request.params.id) }),
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/cms/hooks/:id',
    { preHandler: requireWrite },
    async (request) => {
      const body = patchCmsHookRequestSchema.parse(request.body);
      return { data: await deps.hookService.patch(request.params.id, body) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/cms/hooks/:id',
    { preHandler: requireWrite },
    async (request, reply) => {
      await deps.hookService.delete(request.params.id);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/cms/hooks/:id/attachments',
    { preHandler: requireRead },
    async (request) => ({ data: await deps.hookService.listAttachments(request.params.id) }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/cms/hooks/:id/attachments',
    { preHandler: requireWrite },
    async (request, reply) => {
      const body = cmsHookAttachmentRequestSchema.parse(request.body);
      const attachments = await deps.hookService.addAttachment(
        request.params.id,
        body.blockId,
        body.position,
      );
      return reply.code(201).send({ data: attachments });
    },
  );

  app.patch<{ Params: { id: string; blockId: string } }>(
    '/api/v1/admin/cms/hooks/:id/attachments/:blockId',
    { preHandler: requireWrite },
    async (request) => {
      const body = cmsHookAttachmentRequestSchema.parse({
        ...(request.body as Record<string, unknown> | null | undefined),
        blockId: request.params.blockId,
      });
      return {
        data: await deps.hookService.reorderAttachment(
          request.params.id,
          request.params.blockId,
          body.position,
        ),
      };
    },
  );

  app.delete<{ Params: { id: string; blockId: string } }>(
    '/api/v1/admin/cms/hooks/:id/attachments/:blockId',
    { preHandler: requireWrite },
    async (request, reply) => {
      await deps.hookService.removeAttachment(request.params.id, request.params.blockId);
      return reply.code(204).send();
    },
  );
}
