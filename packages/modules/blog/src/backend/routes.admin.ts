import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createBlogCategoryRequestSchema,
  createBlogPostRequestSchema,
  createBlogTagRequestSchema,
  patchBlogCategoryRequestSchema,
  patchBlogPostRequestSchema,
  patchBlogTagRequestSchema,
  putBlogCategoryDescriptionRequestSchema,
  putBlogCategoryTreeMovesRequestSchema,
  putBlogPostContentRequestSchema,
  setBlogPostRelatedPostsRequestSchema,
  setBlogPostRelatedProductsRequestSchema,
  setBlogPostTagsRequestSchema,
} from '@endora-commerce/contracts';
import { z } from 'zod';
import type { BlogCategoryService } from './services/blog-category-service.js';
import type { BlogPostService } from './services/blog-post-service.js';
import type { BlogTagService } from './services/blog-tag-service.js';
import type { BlogUrlPrefixService } from './services/blog-url-prefix-service.js';
import type { BlogUrlKeyService } from './services/blog-url-keys.js';
import type { BlogAuthors } from './services/blog-authors.js';
import { putBlogUrlKeysRequestSchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

const versionOnlySchema = z.object({ version: z.number().int() });

const versionQuerySchema = z.object({
  version: z.coerce.number().int().optional(),
});

/**
 * DELETE doesn't carry a body (Fetch API limitation in some browsers),
 * so the admin client can pass version as a query parameter. The backend
 * accepts either form: body wins when present, query is the fallback.
 */
function readDeleteVersion(
  body: unknown,
  query: unknown,
): number | undefined {
  if (body && typeof body === 'object') {
    const bv = (body as { version?: unknown }).version;
    if (typeof bv === 'number') return bv;
  }
  const q = versionQuerySchema.safeParse(query ?? {});
  if (q.success) return q.data.version;
  return undefined;
}

const listFiltersSchema = z.object({
  q: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  salesChannelId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  language: z.string().min(2).optional(),
  page: z.coerce.number().int().positive().optional(),
  perPage: z.coerce.number().int().positive().max(100).optional(),
});

const tagListFiltersSchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  perPage: z.coerce.number().int().positive().max(100).optional(),
});

export async function registerBlogAdminRoutes(
  app: FastifyInstance,
  deps: {
    postService: BlogPostService;
    categoryService: BlogCategoryService;
    tagService: BlogTagService;
    urlPrefixService: BlogUrlPrefixService;
    urlKeyService: BlogUrlKeyService;
    authors: BlogAuthors;
    requireAdmin?: RequireAdminFactory;
  },
): Promise<void> {
  const requireRead = deps.requireAdmin?.('blog.read') ?? (async () => {});
  const requireWrite = deps.requireAdmin?.('blog.write') ?? (async () => {});

  // ── Posts ──────────────────────────────────────────────────────────

  app.get('/api/v1/admin/blog/posts', { preHandler: requireRead }, async (request) => {
    const filters = listFiltersSchema.parse(request.query ?? {});
    return deps.postService.list(filters);
  });

  app.post(
    '/api/v1/admin/blog/posts',
    { preHandler: requireWrite },
    async (request, reply) => {
      const body = createBlogPostRequestSchema.parse(request.body);
      const created = await deps.postService.create(body);
      return reply.code(201).send({ data: created });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/blog/posts/:id',
    { preHandler: requireRead },
    async (request) => ({ data: await deps.postService.getById(request.params.id) }),
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/blog/posts/:id',
    { preHandler: requireWrite },
    async (request) => {
      const body = patchBlogPostRequestSchema.parse(request.body);
      return { data: await deps.postService.patch(request.params.id, body) };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/blog/posts/:id/content',
    { preHandler: requireWrite },
    async (request) => {
      const body = putBlogPostContentRequestSchema.parse(request.body);
      return { data: await deps.postService.setContent(request.params.id, body) };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/blog/posts/:id/tags',
    { preHandler: requireWrite },
    async (request) => {
      const body = setBlogPostTagsRequestSchema.parse(request.body);
      return {
        data: await deps.postService.setTags(request.params.id, body.tagIds, body.version),
      };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/blog/posts/:id/related-posts',
    { preHandler: requireWrite },
    async (request) => {
      const body = setBlogPostRelatedPostsRequestSchema.parse(request.body);
      return {
        data: await deps.postService.setRelatedPosts(
          request.params.id,
          body.relatedPostIds,
          body.version,
        ),
      };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/blog/posts/:id/related-products',
    { preHandler: requireWrite },
    async (request) => {
      const body = setBlogPostRelatedProductsRequestSchema.parse(request.body);
      return {
        data: await deps.postService.setRelatedProducts(
          request.params.id,
          body.productIds,
          body.version,
        ),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/blog/posts/:id/publish',
    { preHandler: requireWrite },
    async (request) => {
      const body = versionOnlySchema.parse(request.body ?? {});
      return { data: await deps.postService.publish(request.params.id, body.version) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/blog/posts/:id/unpublish',
    { preHandler: requireWrite },
    async (request) => {
      const body = versionOnlySchema.parse(request.body ?? {});
      return { data: await deps.postService.unpublish(request.params.id, body.version) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/blog/posts/:id/archive',
    { preHandler: requireWrite },
    async (request) => {
      const body = versionOnlySchema.parse(request.body ?? {});
      return { data: await deps.postService.archive(request.params.id, body.version) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/blog/posts/:id',
    { preHandler: requireWrite },
    async (request, reply) => {
      const version =
        readDeleteVersion(request.body, request.query) ??
        versionOnlySchema.parse(request.body ?? { version: 0 }).version;
      const result = await deps.postService.softDelete(request.params.id, version);
      return reply.code(200).send({ data: result });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/blog/posts/:id/inbound-references',
    { preHandler: requireRead },
    async (request) => ({
      data: await deps.postService.getInboundReferences(request.params.id),
    }),
  );

  // ── Categories ─────────────────────────────────────────────────────

  app.get('/api/v1/admin/blog/categories', { preHandler: requireRead }, async () =>
    deps.categoryService.getTree(),
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/blog/categories/:id',
    { preHandler: requireRead },
    async (request) => ({ data: await deps.categoryService.getById(request.params.id) }),
  );

  app.post(
    '/api/v1/admin/blog/categories',
    { preHandler: requireWrite },
    async (request, reply) => {
      const body = createBlogCategoryRequestSchema.parse(request.body);
      const created = await deps.categoryService.create(body);
      return reply.code(201).send({ data: created });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/blog/categories/:id',
    { preHandler: requireWrite },
    async (request) => {
      const body = patchBlogCategoryRequestSchema.parse(request.body);
      return { data: await deps.categoryService.patch(request.params.id, body) };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/blog/categories/:id/description',
    { preHandler: requireWrite },
    async (request) => {
      const body = putBlogCategoryDescriptionRequestSchema.parse(request.body);
      return { data: await deps.categoryService.setDescription(request.params.id, body) };
    },
  );

  app.put('/api/v1/admin/blog/categories/tree', { preHandler: requireWrite }, async (request) => {
    const body = putBlogCategoryTreeMovesRequestSchema.parse(request.body);
    return await deps.categoryService.applyTreeMoves(body.moves);
  });

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/blog/categories/:id',
    { preHandler: requireWrite },
    async (request, reply) => {
      const version = readDeleteVersion(request.body, request.query);
      await deps.categoryService.softDelete(request.params.id, version);
      return reply.code(204).send();
    },
  );

  // ── Tags ───────────────────────────────────────────────────────────

  app.get('/api/v1/admin/blog/tags', { preHandler: requireRead }, async (request) => {
    const filters = tagListFiltersSchema.parse(request.query ?? {});
    return deps.tagService.list(filters);
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/blog/tags/:id',
    { preHandler: requireRead },
    async (request) => ({ data: await deps.tagService.getById(request.params.id) }),
  );

  app.post(
    '/api/v1/admin/blog/tags',
    { preHandler: requireWrite },
    async (request, reply) => {
      const body = createBlogTagRequestSchema.parse(request.body);
      const created = await deps.tagService.create(body);
      return reply.code(201).send({ data: created });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/blog/tags/:id',
    { preHandler: requireWrite },
    async (request) => {
      const body = patchBlogTagRequestSchema.parse(request.body);
      return { data: await deps.tagService.patch(request.params.id, body) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/blog/tags/:id',
    { preHandler: requireWrite },
    async (request, reply) => {
      const version = readDeleteVersion(request.body, request.query);
      await deps.tagService.softDelete(request.params.id, version);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/blog/tags/:id/inbound-references',
    { preHandler: requireRead },
    async (request) => ({
      data: await deps.tagService.getInboundReferences(request.params.id),
    }),
  );

  // ── Authors (feature 171, US7) ─────────────────────────────────────
  // Who may be named a post's author: active administrators, by name and avatar
  // only. Gated on `blog.write` — the editor needs no `admin_users:manage`.

  app.get('/api/v1/admin/blog/author-candidates', { preHandler: requireWrite }, async (request) => {
    const { q } = z.object({ q: z.string().max(120).optional() }).parse(request.query ?? {});
    return { data: await deps.authors.candidates(q) };
  });

  // ── URL keys (feature 171, US4) ────────────────────────────────────
  // The per-language URL keys of posts and categories, and their redirects. The
  // paths are written out per kind so the permission reader can read every one.

  const readUrlKeys = (kind: 'post' | 'category') => async (request: FastifyRequest<{ Params: { id: string } }>) => ({
    data: await deps.urlKeyService.read(kind, request.params.id),
  });
  const writeUrlKeys = (kind: 'post' | 'category') => async (request: FastifyRequest<{ Params: { id: string } }>) => ({
    data: await deps.urlKeyService.update(kind, request.params.id, putBlogUrlKeysRequestSchema.parse(request.body)),
  });
  const deleteRedirect =
    (kind: 'post' | 'category') =>
    async (request: FastifyRequest<{ Params: { id: string; redirectId: string } }>, reply: FastifyReply) => {
      await deps.urlKeyService.deleteRedirect(kind, request.params.id, z.string().uuid().parse(request.params.redirectId));
      return reply.code(204).send();
    };

  app.get<{ Params: { id: string } }>('/api/v1/admin/blog/posts/:id/url-keys', { preHandler: requireRead }, readUrlKeys('post'));
  app.put<{ Params: { id: string } }>('/api/v1/admin/blog/posts/:id/url-keys', { preHandler: requireWrite }, writeUrlKeys('post'));
  app.delete<{ Params: { id: string; redirectId: string } }>(
    '/api/v1/admin/blog/posts/:id/url-redirects/:redirectId',
    { preHandler: requireWrite },
    deleteRedirect('post'),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/blog/categories/:id/url-keys',
    { preHandler: requireRead },
    readUrlKeys('category'),
  );
  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/blog/categories/:id/url-keys',
    { preHandler: requireWrite },
    writeUrlKeys('category'),
  );
  app.delete<{ Params: { id: string; redirectId: string } }>(
    '/api/v1/admin/blog/categories/:id/url-redirects/:redirectId',
    { preHandler: requireWrite },
    deleteRedirect('category'),
  );

  // ── URL prefixes (feature 171) ─────────────────────────────────────
  // The prefix itself is a setting; these list the addresses a channel has
  // served and forget a former one (it then stops redirecting).

  app.get('/api/v1/admin/blog/addresses', { preHandler: requireRead }, async (request) => {
    const { salesChannelId } = urlPrefixListQuerySchema.parse(request.query ?? {});
    return { data: await deps.urlPrefixService.list(salesChannelId) };
  });

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/blog/addresses/:id',
    { preHandler: requireWrite },
    async (request, reply) => {
      await deps.urlPrefixService.forget(z.string().uuid().parse(request.params.id));
      return reply.code(204).send();
    },
  );
}

const urlPrefixListQuerySchema = z.object({ salesChannelId: z.string().uuid().optional() });
