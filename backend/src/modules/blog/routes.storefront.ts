import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@b2b/contracts';
import { z } from 'zod';
import { HttpError } from '../../http/error-envelope.js';
import type { BlogStorefrontResolver } from './services/blog-storefront-resolver.js';

const bySlugQuerySchema = z.object({
  slug: z.string().min(1).max(160),
  page: z.coerce.number().int().positive().optional(),
});

const tagByCodeQuerySchema = z.object({
  code: z.string().min(1).max(64),
  page: z.coerce.number().int().positive().optional(),
});

export async function registerBlogStorefrontRoutes(
  app: FastifyInstance,
  deps: { storefrontResolver: BlogStorefrontResolver },
): Promise<void> {
  app.get('/api/v1/blog/by-channel', async (request) => {
    const { salesChannelCode, language } = readContext(request);
    const resolved = await deps.storefrontResolver.getIndex({
      ...(salesChannelCode !== undefined ? { salesChannelCode } : {}),
      ...(language !== undefined ? { language } : {}),
    });
    if (!resolved) {
      throw new HttpError(404, ERROR_CODES.BLOG_DISABLED, 'Blog is disabled or not configured.');
    }
    return { data: resolved };
  });

  app.get('/api/v1/blog/by-slug', async (request) => {
    const query = bySlugQuerySchema.parse(request.query ?? {});
    const { salesChannelCode, language } = readContext(request);
    const resolved = await deps.storefrontResolver.getBySlug(query.slug, {
      ...(salesChannelCode !== undefined ? { salesChannelCode } : {}),
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
    const { salesChannelCode, language } = readContext(request);
    const resolved = await deps.storefrontResolver.getTagByCode(query.code, {
      ...(salesChannelCode !== undefined ? { salesChannelCode } : {}),
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
  salesChannelCode: string | undefined;
  language: string | undefined;
} {
  const headers = request.headers;
  const salesChannelCode = readHeader(headers['x-sales-channel']);
  const language =
    readHeader(headers['x-blog-language']) ??
    readHeader(headers['accept-language'])?.split(',')[0]?.trim();
  return { salesChannelCode, language };
}

function readHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
