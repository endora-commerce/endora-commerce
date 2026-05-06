// Blog — feature 016 contract surface.
// Posts, Categories, Tags, related lists, storefront resolved payloads.
// Per Principle V these schemas are the source of truth for every HTTP
// boundary in the new `blog` module. The Page Builder content envelope is
// re-exported from `cms.ts` so the Blog and CMS modules share one source
// of truth for editor + renderer (research.md § R1).

import { z } from 'zod';
import { cmsContentEnvelopeSchema } from './cms.js';
import { isoDateTimeSchema, multilingualStringSchema, uuidSchema } from './common.js';

// ────────────────────────────────────────────────────────────────────
// Domain primitives
// ────────────────────────────────────────────────────────────────────

/**
 * Slug: URL-safe segment, lowercase a-z / 0-9 / dash, max 160. The literal
 * `tag` is reserved (R3 + R4) — the negative lookahead refuses it.
 */
export const blogSlugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^(?!tag$)[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/, {
    message:
      'Slug must match ^[a-z0-9-]+$ (1–160 chars), and the literal "tag" is reserved.',
  });
export type BlogSlug = z.infer<typeof blogSlugSchema>;

/**
 * Tag code: globally unique URL-safe identifier. R14.
 */
export const blogTagCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, {
    message: 'Tag code must match ^[a-z0-9-]+$ (1–64 chars).',
  });
export type BlogTagCode = z.infer<typeof blogTagCodeSchema>;

export const blogPostStatusSchema = z.enum(['draft', 'published', 'archived']);
export type BlogPostStatus = z.infer<typeof blogPostStatusSchema>;

export const blogUrlPrefixSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, {
    message: 'URL prefix must match ^[a-z0-9-]+$ (1–64 chars).',
  });
export type BlogUrlPrefix = z.infer<typeof blogUrlPrefixSchema>;

/**
 * Page Builder description envelope — same shape as CMS pages (R1). The
 * value is `null` when the Category has no description authored.
 */
export const blogDescriptionEnvelopeSchema = cmsContentEnvelopeSchema.nullable();
export type BlogDescriptionEnvelope = z.infer<typeof blogDescriptionEnvelopeSchema>;

/**
 * Page Builder content envelope — same shape as CMS pages (R1). Required
 * on Posts (always at least an empty Page Builder document per language).
 */
export const blogContentEnvelopeSchema = cmsContentEnvelopeSchema;
export type BlogContentEnvelope = z.infer<typeof blogContentEnvelopeSchema>;

const metaPerLanguage = z
  .record(
    z.string().min(2),
    z.object({
      title: z.string().max(180).optional(),
      description: z.string().max(400).optional(),
      keywords: z.string().max(400).optional(),
    }),
  )
  .nullable();

// ────────────────────────────────────────────────────────────────────
// Posts — admin
// ────────────────────────────────────────────────────────────────────

export const blogPostSummarySchema = z.object({
  id: uuidSchema,
  name: multilingualStringSchema,
  slug: blogSlugSchema,
  status: blogPostStatusSchema,
  active: z.boolean(),
  publishedAt: isoDateTimeSchema.nullable(),
  description: z.string().nullable(),
  salesChannelIds: z.array(uuidSchema),
  languages: z.array(z.string()),
  categoryIds: z.array(uuidSchema),
  tagIds: z.array(uuidSchema),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type BlogPostSummary = z.infer<typeof blogPostSummarySchema>;

export const blogPostTagRefSchema = z.object({
  id: uuidSchema,
  code: blogTagCodeSchema,
  position: z.number().int().nonnegative(),
});
export type BlogPostTagRef = z.infer<typeof blogPostTagRefSchema>;

export const blogPostDetailSchema = blogPostSummarySchema.extend({
  metaTitle: multilingualStringSchema.nullable(),
  metaDescription: multilingualStringSchema.nullable(),
  metaKeywords: multilingualStringSchema.nullable(),
  meta: metaPerLanguage,
  content: blogContentEnvelopeSchema,
  tags: z.array(blogPostTagRefSchema),
  relatedPostIds: z.array(uuidSchema),
  relatedProductIds: z.array(uuidSchema),
});
export type BlogPostDetail = z.infer<typeof blogPostDetailSchema>;

export const createBlogPostRequestSchema = z.object({
  name: multilingualStringSchema,
  slug: blogSlugSchema,
  active: z.boolean().default(true),
  description: z.string().nullable().optional(),
  salesChannelIds: z.array(uuidSchema).min(1),
  languages: z.array(z.string().min(2)).min(1),
  categoryIds: z.array(uuidSchema).default([]),
  tagIds: z.array(uuidSchema).default([]),
  metaTitle: multilingualStringSchema.nullable().optional(),
  metaDescription: multilingualStringSchema.nullable().optional(),
  metaKeywords: multilingualStringSchema.nullable().optional(),
  content: blogContentEnvelopeSchema.optional(),
});
export type CreateBlogPostRequest = z.infer<typeof createBlogPostRequestSchema>;

export const patchBlogPostRequestSchema = createBlogPostRequestSchema
  .omit({ content: true })
  .partial()
  .extend({ version: z.number().int().optional() })
  .refine((x) => Object.keys(x).length > 0, { message: 'At least one field required.' });
export type PatchBlogPostRequest = z.infer<typeof patchBlogPostRequestSchema>;

export const putBlogPostContentRequestSchema = z.object({
  content: blogContentEnvelopeSchema,
  version: z.number().int(),
});
export type PutBlogPostContentRequest = z.infer<typeof putBlogPostContentRequestSchema>;

export const setBlogPostTagsRequestSchema = z.object({
  tagIds: z.array(uuidSchema),
  version: z.number().int(),
});
export type SetBlogPostTagsRequest = z.infer<typeof setBlogPostTagsRequestSchema>;

export const setBlogPostRelatedPostsRequestSchema = z.object({
  relatedPostIds: z.array(uuidSchema),
  version: z.number().int(),
});
export type SetBlogPostRelatedPostsRequest = z.infer<
  typeof setBlogPostRelatedPostsRequestSchema
>;

export const setBlogPostRelatedProductsRequestSchema = z.object({
  productIds: z.array(uuidSchema),
  version: z.number().int(),
});
export type SetBlogPostRelatedProductsRequest = z.infer<
  typeof setBlogPostRelatedProductsRequestSchema
>;

export const blogPostInboundReferenceSchema = z.object({
  id: uuidSchema,
  name: multilingualStringSchema,
  slug: blogSlugSchema,
});
export type BlogPostInboundReference = z.infer<typeof blogPostInboundReferenceSchema>;

export const blogPostInboundReferencesResponseSchema = z.object({
  asRelatedPostBy: z.array(blogPostInboundReferenceSchema),
});
export type BlogPostInboundReferencesResponse = z.infer<
  typeof blogPostInboundReferencesResponseSchema
>;

// ────────────────────────────────────────────────────────────────────
// Categories — admin
// ────────────────────────────────────────────────────────────────────

export interface BlogCategoryTreeNode {
  id: string;
  parentId: string | null;
  position: number;
  name: Record<string, string>;
  slug: string;
  enabled: boolean;
  isSystem: boolean;
  salesChannelIds: string[];
  languages: string[];
  mainImageAssetId: string | null;
  version: number;
  children: BlogCategoryTreeNode[];
}

export const blogCategoryTreeNodeSchema: z.ZodType<BlogCategoryTreeNode> = z.lazy(() =>
  z.object({
    id: uuidSchema,
    parentId: uuidSchema.nullable(),
    position: z.number().int().nonnegative(),
    name: multilingualStringSchema,
    slug: blogSlugSchema,
    enabled: z.boolean(),
    isSystem: z.boolean(),
    salesChannelIds: z.array(uuidSchema),
    languages: z.array(z.string()),
    mainImageAssetId: uuidSchema.nullable(),
    version: z.number().int(),
    children: z.array(blogCategoryTreeNodeSchema),
  }),
);

export const blogCategoryTreeResponseSchema = z.object({
  tree: z.array(blogCategoryTreeNodeSchema),
});
export type BlogCategoryTreeResponse = z.infer<typeof blogCategoryTreeResponseSchema>;

export const blogCategoryDetailSchema = z.object({
  id: uuidSchema,
  parentId: uuidSchema.nullable(),
  position: z.number().int().nonnegative(),
  name: multilingualStringSchema,
  slug: blogSlugSchema,
  enabled: z.boolean(),
  isSystem: z.boolean(),
  salesChannelIds: z.array(uuidSchema),
  languages: z.array(z.string()),
  mainImageAssetId: uuidSchema.nullable(),
  metaTitle: multilingualStringSchema.nullable(),
  metaDescription: multilingualStringSchema.nullable(),
  metaKeywords: multilingualStringSchema.nullable(),
  description: blogDescriptionEnvelopeSchema,
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type BlogCategoryDetail = z.infer<typeof blogCategoryDetailSchema>;

export const createBlogCategoryRequestSchema = z.object({
  parentId: uuidSchema.nullable(),
  name: multilingualStringSchema,
  slug: blogSlugSchema,
  enabled: z.boolean().default(true),
  salesChannelIds: z.array(uuidSchema).min(1),
  languages: z.array(z.string().min(2)).min(1),
  mainImageAssetId: uuidSchema.nullable().optional(),
  metaTitle: multilingualStringSchema.nullable().optional(),
  metaDescription: multilingualStringSchema.nullable().optional(),
  metaKeywords: multilingualStringSchema.nullable().optional(),
});
export type CreateBlogCategoryRequest = z.infer<typeof createBlogCategoryRequestSchema>;

export const patchBlogCategoryRequestSchema = createBlogCategoryRequestSchema
  .partial()
  .extend({ version: z.number().int().optional() })
  .refine((x) => Object.keys(x).length > 0, { message: 'At least one field required.' });
export type PatchBlogCategoryRequest = z.infer<typeof patchBlogCategoryRequestSchema>;

export const putBlogCategoryDescriptionRequestSchema = z.object({
  description: blogDescriptionEnvelopeSchema,
  version: z.number().int(),
});
export type PutBlogCategoryDescriptionRequest = z.infer<
  typeof putBlogCategoryDescriptionRequestSchema
>;

export const blogCategoryTreeMoveSchema = z.object({
  id: uuidSchema,
  parentId: uuidSchema.nullable(),
  position: z.number().int().nonnegative(),
});
export type BlogCategoryTreeMove = z.infer<typeof blogCategoryTreeMoveSchema>;

export const putBlogCategoryTreeMovesRequestSchema = z.object({
  moves: z.array(blogCategoryTreeMoveSchema).min(1),
});
export type PutBlogCategoryTreeMovesRequest = z.infer<
  typeof putBlogCategoryTreeMovesRequestSchema
>;

// ────────────────────────────────────────────────────────────────────
// Tags — admin
// ────────────────────────────────────────────────────────────────────

export const blogTagDetailSchema = z.object({
  id: uuidSchema,
  name: multilingualStringSchema,
  description: multilingualStringSchema.nullable(),
  code: blogTagCodeSchema,
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type BlogTagDetail = z.infer<typeof blogTagDetailSchema>;

export const createBlogTagRequestSchema = z.object({
  name: multilingualStringSchema,
  description: multilingualStringSchema.nullable().optional(),
  code: blogTagCodeSchema,
});
export type CreateBlogTagRequest = z.infer<typeof createBlogTagRequestSchema>;

export const patchBlogTagRequestSchema = createBlogTagRequestSchema
  .partial()
  .extend({ version: z.number().int().optional() })
  .refine((x) => Object.keys(x).length > 0, { message: 'At least one field required.' });
export type PatchBlogTagRequest = z.infer<typeof patchBlogTagRequestSchema>;

export const blogTagInboundReferencesResponseSchema = z.object({
  posts: z.array(blogPostInboundReferenceSchema),
  totalPosts: z.number().int().nonnegative(),
});
export type BlogTagInboundReferencesResponse = z.infer<
  typeof blogTagInboundReferencesResponseSchema
>;

// ────────────────────────────────────────────────────────────────────
// Storefront resolved payloads
// ────────────────────────────────────────────────────────────────────

export const blogPostCardSchema = z.object({
  id: uuidSchema,
  slug: blogSlugSchema,
  name: z.string(),
  publishedAt: isoDateTimeSchema.nullable(),
  excerpt: z.string().nullable(),
  mainImageUrl: z.string().nullable(),
  primaryCategorySlug: blogSlugSchema.nullable(),
});
export type BlogPostCard = z.infer<typeof blogPostCardSchema>;

export const blogProductCardSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  mainImageUrl: z.string().nullable(),
  price: z
    .object({
      amount: z.string(),
      currency: z.string(),
    })
    .nullable(),
});
export type BlogProductCard = z.infer<typeof blogProductCardSchema>;

export const blogCategoryTileSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: blogSlugSchema,
  mainImageUrl: z.string().nullable(),
});
export type BlogCategoryTile = z.infer<typeof blogCategoryTileSchema>;

export const blogIndexResponseSchema = z.object({
  urlPrefix: blogUrlPrefixSchema,
  latestPosts: z.array(blogPostCardSchema),
  topLevelCategories: z.array(blogCategoryTileSchema),
});
export type BlogIndexResponse = z.infer<typeof blogIndexResponseSchema>;

export const blogPaginationSchema = z.object({
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
  totalItems: z.number().int().nonnegative(),
});
export type BlogPagination = z.infer<typeof blogPaginationSchema>;

export const blogBreadcrumbEntrySchema = z.object({
  name: z.string(),
  url: z.string(),
});
export type BlogBreadcrumbEntry = z.infer<typeof blogBreadcrumbEntrySchema>;

export const blogResolvedCategorySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: blogSlugSchema,
  mainImageUrl: z.string().nullable(),
  description: blogDescriptionEnvelopeSchema,
  metaTitle: z.string().nullable(),
  metaDescription: z.string().nullable(),
  metaKeywords: z.string().nullable(),
  childCategories: z.array(blogCategoryTileSchema),
  breadcrumb: z.array(blogBreadcrumbEntrySchema),
});
export type BlogResolvedCategory = z.infer<typeof blogResolvedCategorySchema>;

export const blogResolvedTagRefSchema = z.object({
  id: uuidSchema,
  code: blogTagCodeSchema,
  name: z.string(),
});
export type BlogResolvedTagRef = z.infer<typeof blogResolvedTagRefSchema>;

export const blogResolvedPostSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: blogSlugSchema,
  publishedAt: isoDateTimeSchema.nullable(),
  metaTitle: z.string().nullable(),
  metaDescription: z.string().nullable(),
  metaKeywords: z.string().nullable(),
  content: blogContentEnvelopeSchema,
  tags: z.array(blogResolvedTagRefSchema),
  relatedPosts: z.array(blogPostCardSchema),
  relatedProducts: z.array(blogProductCardSchema),
  categories: z.array(
    z.object({ id: uuidSchema, name: z.string(), slug: blogSlugSchema }),
  ),
  breadcrumb: z.array(blogBreadcrumbEntrySchema),
});
export type BlogResolvedPost = z.infer<typeof blogResolvedPostSchema>;

export const blogBySlugCategoryResponseSchema = z.object({
  kind: z.literal('category'),
  category: blogResolvedCategorySchema,
  posts: z.object({
    data: z.array(blogPostCardSchema),
    pagination: blogPaginationSchema,
  }),
});
export type BlogBySlugCategoryResponse = z.infer<typeof blogBySlugCategoryResponseSchema>;

export const blogBySlugPostResponseSchema = z.object({
  kind: z.literal('post'),
  post: blogResolvedPostSchema,
});
export type BlogBySlugPostResponse = z.infer<typeof blogBySlugPostResponseSchema>;

export const blogBySlugResponseSchema = z.discriminatedUnion('kind', [
  blogBySlugCategoryResponseSchema,
  blogBySlugPostResponseSchema,
]);
export type BlogBySlugResponse = z.infer<typeof blogBySlugResponseSchema>;

export const blogTagByCodeResponseSchema = z.object({
  tag: z.object({
    id: uuidSchema,
    code: blogTagCodeSchema,
    name: z.string(),
    description: z.string().nullable(),
  }),
  posts: z.object({
    data: z.array(blogPostCardSchema),
    pagination: blogPaginationSchema,
  }),
  breadcrumb: z.array(blogBreadcrumbEntrySchema),
});
export type BlogTagByCodeResponse = z.infer<typeof blogTagByCodeResponseSchema>;

// ────────────────────────────────────────────────────────────────────
// Settings keys (re-exported as constants so admin + backend agree on
// the canonical names)
// ────────────────────────────────────────────────────────────────────

export const BLOG_SETTING_CODES = {
  ENABLED: 'blog.enabled',
  URL_PREFIX: 'blog.url_prefix',
  LATEST_COUNT: 'blog.latest_count',
  POSTS_PER_PAGE: 'blog.posts_per_page',
} as const;

export const BLOG_SETTING_DEFAULTS = {
  enabled: true,
  urlPrefix: 'blog',
  latestCount: 5,
  postsPerPage: 12,
} as const;

/**
 * Reserved Next.js segments — `blog.url_prefix` cannot be set to one of
 * these because the storefront layer would route around the blog. The
 * setter callback (R-5) refuses any value in this set.
 */
export const BLOG_RESERVED_URL_PREFIXES = new Set<string>([
  'api',
  '_next',
  'manifest.webmanifest',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
]);
