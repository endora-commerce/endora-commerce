import type { FastifyInstance } from 'fastify';
import {
  seoEntityTypeSchema,
  upsertSeoMetaOverrideRequestSchema,
} from '@b2b/contracts';
import type { MetaTagResolverService } from './services/meta-tag-resolver.service.js';
import type { SitemapGeneratorService } from './services/sitemap-generator.service.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface SeoRoutesDeps {
  metaResolver: MetaTagResolverService;
  sitemap: SitemapGeneratorService;
  requireAdmin: RequireAdminFactory;
}

export async function registerSeoRoutes(
  app: FastifyInstance,
  deps: SeoRoutesDeps,
): Promise<void> {
  const { metaResolver, sitemap, requireAdmin } = deps;

  app.get('/api/v1/catalog/sitemap.xml', async (_request, reply) => {
    const { payload } = await sitemap.getOrGenerate();
    reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600');
    return payload;
  });

  app.post(
    '/api/v1/admin/seo/sitemap/regenerate',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const { generatedAt } = await sitemap.regenerate();
      const status = await sitemap.getStatus();
      return {
        data: {
          generatedAt: generatedAt.toISOString(),
          urlCount: status.urlCount ?? 0,
          byteSize: status.byteSize ?? 0,
        },
      };
    },
  );

  app.get(
    '/api/v1/admin/seo/sitemap/status',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const status = await sitemap.getStatus();
      return {
        data: {
          generatedAt: status.generatedAt?.toISOString() ?? null,
          urlCount: status.urlCount,
          byteSize: status.byteSize,
        },
      };
    },
  );

  app.get<{
    Params: { entityType: string; entityId: string };
    Querystring: { locale?: string };
  }>(
    '/api/v1/admin/seo/meta/:entityType/:entityId',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const entityType = seoEntityTypeSchema.parse(request.params.entityType);
      const locale = request.query.locale ?? 'en-US';
      const resolved = await metaResolver.resolve({
        entityType,
        entityId: request.params.entityId,
        locale,
      });
      const override = await metaResolver.getOverride({
        entityType,
        entityId: request.params.entityId,
        locale,
      });
      return {
        data: {
          resolved,
          override: override
            ? {
                title: override.title ?? null,
                description: override.description ?? null,
                ogTitle: override.ogTitle ?? null,
                ogDescription: override.ogDescription ?? null,
                ogImageUrl: override.ogImageUrl ?? null,
              }
            : null,
        },
      };
    },
  );

  app.put<{
    Params: { entityType: string; entityId: string };
  }>(
    '/api/v1/admin/seo/meta/:entityType/:entityId',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: upsertSeoMetaOverrideRequestSchema },
    },
    async (request) => {
      const entityType = seoEntityTypeSchema.parse(request.params.entityType);
      const body = upsertSeoMetaOverrideRequestSchema.parse(request.body);
      const row = await metaResolver.upsertOverride({
        entityType,
        entityId: request.params.entityId,
        locale: body.locale,
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.ogTitle !== undefined ? { ogTitle: body.ogTitle } : {}),
        ...(body.ogDescription !== undefined ? { ogDescription: body.ogDescription } : {}),
        ...(body.ogImageUrl !== undefined ? { ogImageUrl: body.ogImageUrl } : {}),
      });
      return {
        data: {
          id: row.id,
          locale: row.locale,
          title: row.title ?? null,
          description: row.description ?? null,
          ogTitle: row.ogTitle ?? null,
          ogDescription: row.ogDescription ?? null,
          ogImageUrl: row.ogImageUrl ?? null,
        },
      };
    },
  );

  app.delete<{
    Params: { entityType: string; entityId: string };
    Querystring: { locale?: string };
  }>(
    '/api/v1/admin/seo/meta/:entityType/:entityId',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const entityType = seoEntityTypeSchema.parse(request.params.entityType);
      const locale = request.query.locale ?? 'en-US';
      await metaResolver.deleteOverride({
        entityType,
        entityId: request.params.entityId,
        locale,
      });
      reply.status(204).send();
    },
  );
}
