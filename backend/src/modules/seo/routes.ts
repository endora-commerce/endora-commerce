import type { FastifyInstance } from 'fastify';
import {
  seoEntityTypeSchema,
  upsertSeoMetaOverrideRequestSchema,
} from '@b2b/contracts';
import type { MetaTagResolverService } from './services/meta-tag-resolver.service.js';
import type { SitemapGeneratorService } from './services/sitemap-generator.service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

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

  // -- Public sitemap -------------------------------------------------------
  //
  // Resolves the channel from `request.salesChannel` (set by the
  // SalesChannelResolverMiddleware via header / query / host map / system
  // default). Each channel has its own cache row; if the resolver did not
  // attach a channel (e.g. middleware bypass in tests), we serve nothing.
  app.get('/api/v1/catalog/sitemap.xml', { config: { streamingResponse: true } }, async (request, reply) => {
    const channel = request.salesChannel;
    if (!channel) {
      reply
        .status(503)
        .header('Content-Type', 'application/xml; charset=utf-8')
        .header('Cache-Control', 'no-store');
      return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>\n';
    }
    const { payload } = await sitemap.getOrGenerateForChannel(channel.code);
    reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600');
    return payload;
  });

  // -- Admin: per-channel listing ------------------------------------------

  app.get(
    '/api/v1/admin/seo/sitemap',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const rows = await sitemap.listChannelStatuses();
      return {
        data: rows.map((r) => ({
          salesChannelCode: r.salesChannelCode,
          salesChannelName: r.salesChannelName,
          storefrontUrl: r.storefrontUrl,
          storefrontUrlSource: r.storefrontUrlSource,
          generatedAt: r.generatedAt?.toISOString() ?? null,
          urlCount: r.urlCount,
          byteSize: r.byteSize,
        })),
      };
    },
  );

  // -- Admin: per-channel regenerate ---------------------------------------

  app.post<{ Params: { channelCode: string } }>(
    '/api/v1/admin/seo/sitemap/:channelCode/regenerate',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const { channelCode } = request.params;
      const { generatedAt } = await sitemap.regenerateForChannel(channelCode);
      const status = await sitemap.getStatusForChannel(channelCode);
      return {
        data: {
          salesChannelCode: channelCode,
          generatedAt: generatedAt.toISOString(),
          urlCount: status.urlCount ?? 0,
          byteSize: status.byteSize ?? 0,
        },
      };
    },
  );

  // -- Admin: per-channel status -------------------------------------------

  app.get<{ Params: { channelCode: string } }>(
    '/api/v1/admin/seo/sitemap/:channelCode/status',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const status = await sitemap.getStatusForChannel(request.params.channelCode);
      return {
        data: {
          salesChannelCode: request.params.channelCode,
          generatedAt: status.generatedAt?.toISOString() ?? null,
          urlCount: status.urlCount,
          byteSize: status.byteSize,
        },
      };
    },
  );

  // -- Admin: preview / download cached XML --------------------------------
  //
  // `?download=1` flips Content-Disposition to attachment so the browser
  // saves the XML; otherwise the response renders inline (the admin UI
  // opens it in a new tab for preview).
  app.get<{
    Params: { channelCode: string };
    Querystring: { download?: string };
  }>(
    '/api/v1/admin/seo/sitemap/:channelCode/xml',
    { preHandler: requireAdmin('catalog:write'), config: { streamingResponse: true } },
    async (request, reply) => {
      const { channelCode } = request.params;
      const { payload } = await sitemap.getOrGenerateForChannel(channelCode);
      reply
        .header('Content-Type', 'application/xml; charset=utf-8')
        .header('Cache-Control', 'no-store');
      const isDownload =
        typeof request.query.download === 'string' &&
        request.query.download !== '' &&
        request.query.download !== '0' &&
        request.query.download.toLowerCase() !== 'false';
      if (isDownload) {
        reply.header(
          'Content-Disposition',
          `attachment; filename="sitemap-${channelCode}.xml"`,
        );
      } else {
        reply.header('Content-Disposition', 'inline');
      }
      return payload;
    },
  );

  // -- Meta editor ----------------------------------------------------------

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
      return reply.status(204).send();
    },
  );
}
