import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ERROR_CODES, blogPostsListQuerySchema } from '@endora-commerce/contracts';
import { z } from 'zod';
import { HttpError } from '@endora-commerce/platform/http';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import type { BlogStorefrontResolver, ResolvedChannel } from './services/blog-storefront-resolver.js';
import type { BlogUrlPrefixService } from './services/blog-url-prefix-service.js';

const bySlugQuerySchema = z.object({
  slug: z.string().min(1).max(160),
  page: z.coerce.number().int().positive().optional(),
});

const indexQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
});

const tagByCodeQuerySchema = z.object({
  code: z.string().min(1).max(64),
  page: z.coerce.number().int().positive().optional(),
});

export async function registerBlogStorefrontRoutes(
  app: FastifyInstance,
  deps: { storefrontResolver: BlogStorefrontResolver; urlPrefixService: BlogUrlPrefixService },
): Promise<void> {
  /**
   * Feature 171 — what the storefront middleware maps the public blog prefix with,
   * for the resolved channel only (Constitution XII). 404 when the blog is disabled
   * there, so the middleware leaves every path alone.
   */
  app.get('/api/v1/blog/routing', async (request) => {
    const routing = await deps.urlPrefixService.routingFor(resolvedChannel(request));
    if (!routing) {
      throw new HttpError(404, ERROR_CODES.BLOG_DISABLED, 'Blog is disabled or not configured.');
    }
    return { data: routing };
  });

  app.get('/api/v1/blog/by-channel', async (request) => {
    const { language } = readContext(request);
    const { page } = indexQuerySchema.parse(request.query ?? {});
    const resolved = await deps.storefrontResolver.getIndex({
      resolvedChannel: resolvedChannel(request),
      ...(language !== undefined ? { language } : {}),
      ...(page !== undefined ? { page } : {}),
    });
    if (!resolved) {
      throw new HttpError(404, ERROR_CODES.BLOG_DISABLED, 'Blog is disabled or not configured.');
    }
    return { data: resolved };
  });

  /**
   * Feature 163 — the card list behind `blog.LatestPosts`, in the resolved
   * channel only (Constitution XII): the channel comes from the resolver
   * middleware, which falls back to the system default channel and never to
   * every channel. `limit` above 24 is a 400 through the schema.
   */
  app.get('/api/v1/blog/posts', async (request) => {
    const query = blogPostsListQuerySchema.parse(request.query ?? {});
    const { language } = readContext(request);
    return deps.storefrontResolver.listPosts({
      resolvedChannel: resolvedChannel(request),
      ...(language !== undefined ? { language } : {}),
      page: query.page,
      perPage: query.perPage,
      ...(query.categorySlug !== undefined ? { categorySlug: query.categorySlug } : {}),
      ...(query.tagCode !== undefined ? { tagCode: query.tagCode } : {}),
      ...(query.authorId !== undefined ? { authorId: query.authorId } : {}),
    });
  });

  app.get('/api/v1/blog/by-slug', async (request) => {
    const query = bySlugQuerySchema.parse(request.query ?? {});
    const { language } = readContext(request);
    const resolved = await deps.storefrontResolver.getBySlug(query.slug, {
      resolvedChannel: resolvedChannel(request),
      ...(language !== undefined ? { language } : {}),
      ...(query.page !== undefined ? { page: query.page } : {}),
    });
    if (!resolved) {
      throw new HttpError(
        404,
        ERROR_CODES.BLOG_POST_NOT_FOUND,
        'No blog Post or Category at that slug, or the blog is disabled in this scope.',
      );
    }
    return { data: resolved };
  });

  app.get('/api/v1/blog/tag-by-code', async (request) => {
    const query = tagByCodeQuerySchema.parse(request.query ?? {});
    const { language } = readContext(request);
    const resolved = await deps.storefrontResolver.getTagByCode(query.code, {
      resolvedChannel: resolvedChannel(request),
      ...(language !== undefined ? { language } : {}),
      ...(query.page !== undefined ? { page: query.page } : {}),
    });
    if (!resolved) {
      throw new HttpError(
        404,
        ERROR_CODES.BLOG_TAG_NOT_FOUND,
        'No blog Tag at that code, or the blog is disabled in this scope.',
      );
    }
    return { data: resolved };
  });
}

function readContext(request: FastifyRequest): {
  language: string | undefined;
} {
  const headers = request.headers;
  const language =
    readHeader(headers['x-blog-language']) ??
    readHeader(headers['accept-language'])?.split(',')[0]?.trim();
  return { language };
}

/**
 * Read the sales channel already resolved by the sales-channel resolver
 * middleware for this request. Feature 053: routes no longer re-parse the
 * `x-sales-channel` header nor re-query `sales_channels`.
 */
function resolvedChannel(request: FastifyRequest): ResolvedChannel {
  const ch = getResolvedChannel(request);
  return {
    id: ch.id,
    code: ch.code,
    defaultLanguage: ch.defaultLanguage,
    languages: ch.languages,
    prefixDefaultLanguage: ch.prefixDefaultLanguage,
  };
}

function readHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
