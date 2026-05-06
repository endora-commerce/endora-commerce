import type { FastifyInstance } from 'fastify';
import {
  createBlogPostRequestSchema,
  patchBlogPostRequestSchema,
  putBlogPostContentRequestSchema,
  setBlogPostRelatedPostsRequestSchema,
  setBlogPostRelatedProductsRequestSchema,
  setBlogPostTagsRequestSchema,
} from '@b2b/contracts';
import { z } from 'zod';
import type { RequireAdminFactory } from './plugin.js';
import type { BlogPostService } from './services/blog-post-service.js';

const versionOnlySchema = z.object({ version: z.number().int() });

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

export async function registerBlogAdminRoutes(
  app: FastifyInstance,
  deps: {
    postService: BlogPostService;
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
      const body = versionOnlySchema.parse(request.body ?? {});
      const result = await deps.postService.softDelete(request.params.id, body.version);
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
}
