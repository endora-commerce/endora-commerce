import type { FastifyInstance } from 'fastify';
import {
  ERROR_CODES,
  adminCrawlerFilePreviewQuerySchema,
  scopeFromRequest,
  scopeRequestSchema,
  seoEntityTypeSchema,
  seoMetaScopeQuerySchema,
  upsertSeoMetaOverrideRequestSchema,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { MetaTagResolverService } from './services/meta-tag-resolver.service.js';
import type { SitemapGeneratorService } from './services/sitemap-generator.service.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { currentSalesChannel, getResolvedChannel } from '@endora-commerce/platform/kernel';
import { z } from 'zod';
import {
  DEFAULT_ROBOTS_SETTING_CODE,
  UnknownRobotsTokenError,
  robotsPolicyForToken,
} from './services/robots-policy.js';
import {
  StoredCrawlerTextTooLargeError,
  resolveCrawlerFiles,
  type CrawlerFilesSettingsPort,
} from './services/crawler-files.service.js';
import {
  UnknownSalesChannelError,
  type CrawlerFilePreviewService,
} from './services/crawler-file-preview.service.js';

/** The reads this module's routes make of the settings store. */
export interface SeoRouteSettingsPort extends CrawlerFilesSettingsPort {
  get<T>(code: string, salesChannelId: string, schema: z.ZodType<T>): Promise<T>;
}

export interface SeoRoutesDeps {
  metaResolver: MetaTagResolverService;
  sitemap: SitemapGeneratorService;
  crawlerFilePreview: Pick<CrawlerFilePreviewService, 'preview'>;
  requireAdmin: RequireAdminFactory;
  settings: SeoRouteSettingsPort;
}

export async function registerSeoRoutes(
  app: FastifyInstance,
  deps: SeoRoutesDeps,
): Promise<void> {
  const { metaResolver, sitemap, crawlerFilePreview, requireAdmin, settings } = deps;

  // -- Public: a sales channel's default robots policy ----------------------
  //
  // `specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §1. The
  // storefront's middleware asks this on behalf of every response it serves
  // and is itself the cache, which is why no intermediary may keep the answer.
  //
  // The channel is the request's resolved one — its `X-Sales-Channel`, else
  // the system default — so there is no "no channel" answer and no value is
  // ever computed across channels (Principle XII). The settings store resolves
  // the channel's own value, else the all-channels value, else the declared
  // default.
  //
  // There is no presence check here. The registration seam answers `503`
  // `MODULE_DISABLED` for every route of an absent module, and the storefront
  // reads that as "this feature does not exist".
  //
  // A stored value that cannot be read — not a string, or not one of the four
  // choices — is a `500` and never a permissive `200`: the storefront keeps
  // what it knew instead of withdrawing a `noindex` nobody withdrew.
  // Feature 154 — reachable whatever the sales-channel access rule decides:
  // the crawler policy of a closed store is still served.
  app.get('/api/v1/storefront/seo/robots-policy', { config: { salesChannelAccess: 'open' } }, async (request, reply) => {
    const channel = getResolvedChannel(request);
    reply.header('Cache-Control', 'no-store');
    const stored = await settings.get(DEFAULT_ROBOTS_SETTING_CODE, channel.id, z.string());
    try {
      return { data: robotsPolicyForToken(stored) };
    } catch (error) {
      if (error instanceof UnknownRobotsTokenError) {
        // The value is a directive spelling, not a secret; it is what an
        // operator needs to find the row.
        request.log.error(
          {
            settingCode: DEFAULT_ROBOTS_SETTING_CODE,
            salesChannelCode: channel.code,
            storedValue: stored,
          },
          'seo: the stored default robots value is not one of the declared choices',
        );
      }
      throw error;
    }
  });

  // -- Public: what a sales channel's crawler files are built from -----------
  //
  // `specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §2. The
  // storefront asks this when it serves `robots.txt` or `llms.txt`, and is
  // itself the cache.
  //
  // The channel is resolved exactly as above, and every value in the answer is
  // that channel's: one channel's instructions are never in another channel's
  // answer, and there is no answer computed across channels (Principle XII).
  //
  // The operator's text is in the body as a JSON string, as it was stored. It
  // is never a header, never a status line and never this response's content
  // type — which is the platform's, for JSON.
  //
  // No presence check, for the reason given above: `MODULE_DISABLED` is what
  // tells the storefront to serve its own rules alone.
  //
  // Stored `robots.txt` instructions this module cannot stand behind are a
  // `500` and never an empty text at `200`. An unreadable default robots or
  // `llms.txt` content is named in the answer instead, so that it costs the
  // channel its `llms.txt` and not its `robots.txt` — see
  // `services/crawler-files.service.ts`.
  //
  // **Open on a store closed to anonymous visitors** (`specs/154-sales-channel-access/`,
  // research R-4): `robots.txt` and `llms.txt` are served on every store. On a
  // closed one there is nothing public to crawl, and the answer says so in
  // `anonymousAccess` — the storefront then serves a `robots.txt` that
  // disallows everything and an `llms.txt` that lists nothing.
  app.get('/api/v1/storefront/seo/crawler-files', { config: { salesChannelAccess: 'open' } }, async (request, reply) => {
    const channel = getResolvedChannel(request);
    reply.header('Cache-Control', 'no-store');
    try {
      const files = await resolveCrawlerFiles(settings, channel);
      if (files.unreadable !== undefined) {
        // Answered, with what could not be read named in it — `robots.txt`
        // needs none of it. Names of members only; never a stored value.
        request.log.error(
          { salesChannelCode: channel.code, unreadable: files.unreadable },
          'seo: a stored crawler-file setting cannot be read; llms.txt is not served for the channel',
        );
      }
      return { data: files };
    } catch (error) {
      if (error instanceof StoredCrawlerTextTooLargeError) {
        // The message names the setting and what is wrong with it, and carries
        // none of the text.
        request.log.error(
          { salesChannelCode: channel.code, reason: error.message },
          'seo: a stored crawler-file setting cannot be served',
        );
      }
      throw error;
    }
  });

  // -- Admin: the preview of a sales channel's crawler file ------------------
  //
  // `specs/144-seo-search-engine-robots/contracts/admin-surfaces.md` §3. The
  // Settings screen shows, beside the operator's text, the file the channel's
  // storefront will serve. The rules the storefront generates are the
  // storefront's (FR-041), so the service asks that storefront for them and
  // this route hands back both parts; it stores nothing and caches nothing.
  //
  // **The permission is `settings:read`**, the code that lets somebody see the
  // setting the preview sits beside (FR-045). It shows a public file and the
  // saved text that reader can already see, and it writes nothing — so there
  // is no Command and no audit entry.
  //
  // **The caller says which file and which channel, and nothing else.** The
  // query schema is strict: no address, path or header of the caller's reaches
  // the request the service makes, and a member it does not declare is a `400`.
  // The guard runs before that validation, so an unauthenticated caller learns
  // nothing about what the route accepts.
  //
  // No presence check, for the reason given on the storefront routes above:
  // while `seo` is off the registration seam answers `503` `MODULE_DISABLED`.
  app.get(
    '/api/v1/admin/seo/crawler-files/preview',
    {
      preHandler: requireAdmin('settings:read'),
      schema: { querystring: adminCrawlerFilePreviewQuerySchema },
    },
    async (request, reply) => {
      const { file, salesChannelCode } = adminCrawlerFilePreviewQuerySchema.parse(request.query);
      reply.header('Cache-Control', 'no-store');
      try {
        const { preview, reason } = await crawlerFilePreview.preview(file, salesChannelCode);
        if (preview.state !== 'ok') {
          // Why, for whoever operates the instance. The response carries the
          // state alone: it says whether a preview can be shown, not what is
          // listening at an address.
          //
          // `address-unknown` is `debug`: it is the resting state of a fresh
          // instance, where nobody has configured an address yet, and an
          // `info` line on every visit to the Settings screen would be noise.
          // So is `not-served`: it is what a channel kept out of search
          // answers for its `llms.txt`, by design.
          const details = {
            salesChannelCode: preview.salesChannelCode,
            file,
            state: preview.state,
            reason,
          };
          const message = 'seo: the crawler-file preview could not show the storefront’s part';
          if (preview.state === 'address-unknown' || preview.state === 'not-served') {
            request.log.debug(details, message);
          } else {
            request.log.info(details, message);
          }
        }
        return { data: preview };
      } catch (error) {
        if (error instanceof UnknownSalesChannelError) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Sales channel not found.');
        }
        if (
          error instanceof UnknownRobotsTokenError ||
          error instanceof StoredCrawlerTextTooLargeError
        ) {
          request.log.error(
            { salesChannelCode: salesChannelCode ?? null, reason: error.message },
            'seo: a stored crawler-file setting cannot be previewed',
          );
        }
        throw error;
      }
    },
  );

  // -- Public sitemap -------------------------------------------------------
  //
  // Resolves the channel from the request scope (filled by the
  // SalesChannelResolverMiddleware via header / query / host map / system
  // default). Each channel has its own cache row; if the resolver did not
  // resolve a channel (e.g. middleware bypass in tests), we serve nothing.
  app.get('/api/v1/catalog/sitemap.xml', { config: { streamingResponse: true } }, async (_request, reply) => {
    const channel = currentSalesChannel();
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
  //
  // Feature 163 (`specs/163-product-data-scopes/contracts/seo-media-attachments.md`
  // §1) — a row is addressed by (entity, `channelId?`, `locale?`): the query for
  // GET and DELETE, the body for PUT. Naming neither is the `en-US` language row,
  // as before. `resolved` is the walk at the named scope (channel × language →
  // channel → language → the rule), `sources` says which scope each field came
  // from; `override` is the row at exactly the address.

  // Feature 170 (FR-093, `contracts/seo-ports.md` §4) — a product's metadata at one scope, on
  // `catalog:read`: whoever may read the product may read its SEO. A static route, so Fastify
  // answers it before the parametric one below, which stays on `catalog:write` for categories
  // and CMS pages. The scope is the editor's (`scoped-values-api.md` §1): neither half = Global,
  // a channel = Channel, both = Channel × language; a language alone, a channel the product is
  // not sold in or a language the channel does not offer is `422`. `scoped` is each field's view
  // at that scope; `resolved` is what the storefront would show there, the derived value filling
  // what no row holds.
  app.get<{ Params: { entityId: string } }>(
    '/api/v1/admin/seo/meta/product/:entityId',
    { preHandler: requireAdmin('catalog:read') },
    async (request) => {
      assertEntityId(request.params.entityId);
      const query = scopeRequestSchema.parse(request.query ?? {});
      const parsed = scopeFromRequest(query);
      if (!parsed.ok) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A product has no language-only scope; name a sales channel.', {
          field: 'scope',
          reason: parsed.reason,
        });
      }
      const { scope } = parsed;
      const entityId = request.params.entityId;
      const scoped = await metaResolver.readScoped(entityId, scope);
      const { resolved, sources } = await metaResolver.resolveWithSources({
        entityType: 'product',
        entityId,
        channelId: scope.level === 'global' ? null : scope.channelId,
        locale: scope.level === 'channel_language' ? scope.languageCode : null,
      });
      return { data: { scope, scoped, resolved, sources } };
    },
  );

  app.get<{
    Params: { entityType: string; entityId: string };
  }>(
    '/api/v1/admin/seo/meta/:entityType/:entityId',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      assertEntityId(request.params.entityId);
      const entityType = seoEntityTypeSchema.parse(request.params.entityType);
      const scope = seoMetaScopeQuerySchema.parse(request.query ?? {});
      const target = { entityType, entityId: request.params.entityId, ...scope };
      const { resolved, sources } = await metaResolver.resolveWithSources(target);
      const override = await metaResolver.getOverride(target);
      return {
        data: {
          resolved,
          // Feature 163 (T126): per field, the scope its value comes from.
          sources,
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
      assertEntityId(request.params.entityId);
      const entityType = seoEntityTypeSchema.parse(request.params.entityType);
      refuseProductWrite(entityType);
      const body = upsertSeoMetaOverrideRequestSchema.parse(request.body);
      const row = await metaResolver.upsertOverride({
        entityType,
        entityId: request.params.entityId,
        ...(body.channelId !== undefined ? { channelId: body.channelId } : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.ogTitle !== undefined ? { ogTitle: body.ogTitle } : {}),
        ...(body.ogDescription !== undefined ? { ogDescription: body.ogDescription } : {}),
        ...(body.ogImageUrl !== undefined ? { ogImageUrl: body.ogImageUrl } : {}),
      });
      return {
        data: {
          id: row.id,
          locale: row.locale ?? null,
          channelId: row.salesChannelId ?? null,
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
  }>(
    '/api/v1/admin/seo/meta/:entityType/:entityId',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      assertEntityId(request.params.entityId);
      const entityType = seoEntityTypeSchema.parse(request.params.entityType);
      refuseProductWrite(entityType);
      const scope = seoMetaScopeQuerySchema.parse(request.query ?? {});
      await metaResolver.deleteOverride({ entityType, entityId: request.params.entityId, ...scope });
      return reply.status(204).send();
    },
  );
}

/**
 * Feature 170 (R21, FR-094) — product metadata is written only through `catalog`'s save, which
 * carries it to `seoProductMetaWritePort` inside its own Command: one audit path for a product. The
 * generic editor keeps writing category and CMS-page rows.
 */
function refuseProductWrite(entityType: string): void {
  if (entityType === 'product') {
    throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Product SEO is saved with the product, in the product editor.', {
      field: 'entityType',
      reason: 'product_seo_saved_with_product',
    });
  }
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Feature 163, checkpoint F (S-5) — `seo_meta_overrides.entity_id` is a `uuid` column,
 * so an id that is not one would reach PostgreSQL as a 500. It names no entity: `404`.
 * Shape only, as PostgreSQL checks it (no version or variant bits).
 */
function assertEntityId(entityId: string): void {
  if (!UUID_SHAPE.test(entityId)) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'SEO target not found.');
  }
}
