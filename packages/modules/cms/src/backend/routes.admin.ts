import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  assessBrandContrast,
  createCmsBlockRequestSchema,
  createCmsHookRequestSchema,
  createCmsPageRequestSchema,
  createCmsTemplateRequestSchema,
  cmsHookAttachmentRequestSchema,
  cmsPageBuilderTranslateRequestSchema,
  patchCmsBlockRequestSchema,
  patchCmsHookRequestSchema,
  patchCmsPageRequestSchema,
  patchCmsTemplateRequestSchema,
  putCmsColorPaletteRequestSchema,
  putCmsBrandTokensRequestSchema,
  putCmsPageContentRequestSchema,
  type CmsBrandTokensAdminRead,
} from '@endora-commerce/contracts';
import type { ColorPaletteAuditContext, ColorPaletteWriter } from './plugin.js';
import type { CmsPageService } from './services/cms-page-service.js';
import type { PageBuilderRegistry } from './services/page-builder-registry.js';
import type { CmsBlockService } from './services/cms-block-service.js';
import type { CmsHookService } from './services/cms-hook-service.js';
import type { CmsTemplateService } from './services/cms-template-service.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { PageBuilderTranslationService } from './services/translation/page-builder-translation.service.js';
import type { CmsBrandTokensService } from './services/brand-tokens-service.js';

/** Feature 151 — a canvas at the 200 000-character ceiling, with styling, stays below this. */
const TRANSLATE_BODY_LIMIT = 5 * 1024 * 1024;

/** `?salesChannelId=` on the brand-token and page-builder reads; absent means the global set. */
const salesChannelQuerySchema = z.object({ salesChannelId: z.string().uuid().optional() });

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
    translation: PageBuilderTranslationService;
    brandTokensService: CmsBrandTokensService;
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

  /**
   * The deployment's reserved first path segments, for the page editor's inline
   * warning (feature 105, FR-033; `contracts/cms-page-url.md` §5.3).
   *
   * **One source, two readers.** This answers from `CmsPageService`, off the
   * same Setting the save-time refusal enforces, so the warning an operator
   * reads while typing and the refusal they meet on Save cannot disagree.
   *
   * It is this module's endpoint rather than `GET /api/v1/admin/settings/:code`
   * for a reason that is about the operator and not about layering: that route
   * is gated `settings:read`, and a content editor holding `cms.write` without
   * it would get a warning that silently never fires — the exact silence this
   * phase exists to remove, reintroduced one permission over.
   *
   * `/pages/:id` below is no hazard: Fastify's radix router prefers a static
   * segment over a parametric one whatever the registration order, so
   * `reserved-segments` is never read as a page id.
   */
  app.get(
    '/api/v1/admin/cms/pages/reserved-segments',
    { preHandler: requireRead },
    async () => ({ data: { segments: await deps.pageService.reservedSegments() } }),
  );

  // Feature 163 (research R-4): `?salesChannelId=` selects whose brand tokens
  // the descriptor carries, so the canvas previews the channel being edited.
  app.get('/api/v1/admin/cms/page-builder/config', { preHandler: requireRead }, async (request) => {
    const query = salesChannelQuerySchema.parse(request.query ?? {});
    return {
      data: await deps.pageBuilderRegistry.describe({ salesChannelId: query.salesChannelId ?? null }),
    };
  });

  /**
   * Feature 163 — brand tokens (`contracts/storefront-and-admin-api.md` §1).
   *
   * Read under `cms.read`, so an editor sees the brand the canvas is styled
   * with; written under its own code, `cms.brand`, because the brand is every
   * page at once and not one page's content. The write is the Command
   * `cms.brand_tokens.update` inside the service; the contrast findings are
   * warnings and never refuse a save (FR-006b).
   */
  app.get('/api/v1/admin/cms/brand-tokens', { preHandler: requireRead }, async (request) => {
    const query = salesChannelQuerySchema.parse(request.query ?? {});
    const read = await deps.brandTokensService.read(query.salesChannelId ?? null);
    const data: CmsBrandTokensAdminRead = {
      global: read.global,
      ...(read.channel ? { channel: read.channel } : {}),
      effective: read.effective,
      warnings: assessBrandContrast(read.effective),
    };
    return { data };
  });

  const requireBrand = deps.requireAdmin('cms.brand');

  app.put(
    '/api/v1/admin/cms/brand-tokens',
    { preHandler: requireBrand },
    async (request) => {
      const body = putCmsBrandTokensRequestSchema.parse(request.body);
      return {
        data: await deps.brandTokensService.update(body.scope, body.tokens, body.expectedVersion),
      };
    },
  );

  /**
   * Feature 151 — the Page Builder translation
   * (`specs/151-page-builder-translate/contracts/page-builder-translation-api.md`).
   *
   * Both behind their own code, `cms.translate`: sending content to a third
   * party and spending money on it is a separate decision from editing it. The
   * capability lets the editor show the action disabled with a reason before a
   * click; it answers `unavailable` rather than 503 while `credentials` is off.
   */
  const requireTranslate = deps.requireAdmin('cms.translate');

  app.get('/api/v1/admin/cms/page-builder/translation', { preHandler: requireTranslate }, async () => ({
    data: await deps.translation.capability(),
  }));

  app.post(
    '/api/v1/admin/cms/page-builder/translate',
    { preHandler: requireTranslate, bodyLimit: TRANSLATE_BODY_LIMIT },
    async (request) => {
      const body = cmsPageBuilderTranslateRequestSchema.parse(request.body);
      return { data: await deps.translation.translate(body) };
    },
  );

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
      // The block id is the path's, and a malformed one names no attachment: the
      // service answers it as an unknown one rather than the schema's `400` (#781).
      const body = cmsHookAttachmentRequestSchema.pick({ position: true }).parse(request.body ?? {});
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
