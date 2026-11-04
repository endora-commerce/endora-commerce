// Blog — feature 016 contract surface.
// Posts, Categories, Tags, related lists, storefront resolved payloads.
// Per Principle V these schemas are the source of truth for every HTTP
// boundary in the new `blog` module. The Page Builder content envelope is
// re-exported from `cms.ts` so the Blog and CMS modules share one source
// of truth for editor + renderer (research.md § R1).

import { z } from 'zod';
import { cmsContentEnvelopeSchema } from './cms.js';
import { isoDateTimeSchema, multilingualStringSchema, uuidSchema } from './common.js';
import { storefrontPagePath, type ChannelUrlFacts } from './storefront-language-path.js';

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
  mainImageAssetId: uuidSchema.nullable(),
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

/**
 * Feature 171 (US7) — a post's author as the admin editor sees it: an administrator,
 * whose `state` says whether they can still be picked (`inactive`) or are gone
 * (`deleted` — the storefront then shows no author).
 */
export const blogPostAuthorAdminSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  state: z.enum(['active', 'inactive', 'deleted']),
});
export type BlogPostAuthorAdmin = z.infer<typeof blogPostAuthorAdminSchema>;

/** `GET /api/v1/admin/blog/author-candidates` — who may be named the author: active administrators, nothing else about them. */
export const blogAuthorCandidateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type BlogAuthorCandidate = z.infer<typeof blogAuthorCandidateSchema>;

export const blogPostDetailSchema = blogPostSummarySchema.extend({
  metaTitle: multilingualStringSchema.nullable(),
  metaDescription: multilingualStringSchema.nullable(),
  metaKeywords: multilingualStringSchema.nullable(),
  meta: metaPerLanguage,
  content: blogContentEnvelopeSchema,
  tags: z.array(blogPostTagRefSchema),
  relatedPostIds: z.array(uuidSchema),
  relatedProductIds: z.array(uuidSchema),
  /** Feature 171 (US7). Optional for clients that predate it. */
  author: blogPostAuthorAdminSchema.nullable().optional(),
});
export type BlogPostDetail = z.infer<typeof blogPostDetailSchema>;

export const createBlogPostRequestSchema = z.object({
  name: multilingualStringSchema,
  slug: blogSlugSchema,
  active: z.boolean().default(true),
  description: z.string().nullable().optional(),
  mainImageAssetId: uuidSchema.nullable().optional(),
  /** Feature 171 (US7) — the administrator named as the post's author; `null` names none. */
  authorAdminUserId: uuidSchema.nullable().optional(),
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
// Storefront paths — feature 171 (`specs/171-blog-i18n-authors/`)
// ────────────────────────────────────────────────────────────────────

/** Which blog view a path names. Posts and categories share one URL space (`entry`). */
export type BlogPathView =
  | { view: 'index'; page?: number | undefined }
  | { view: 'entry'; key: string; page?: number | undefined }
  | { view: 'tag'; code: string; page?: number | undefined };

/** The logical (language-less) blog path: `/<prefix>[/<key> | /tag/<code>][?page=N]`. */
function blogLogicalPath(input: BlogPathView & { prefix: string }): string {
  let path = `/${input.prefix}`;
  if (input.view === 'entry') path += `/${encodeURIComponent(input.key)}`;
  if (input.view === 'tag') path += `/tag/${encodeURIComponent(input.code)}`;
  if (input.page !== undefined && input.page >= 2) path += `?page=${input.page}`;
  return path;
}

/**
 * The storefront path of a blog view under the blog prefix of its language and the
 * language's path prefix (feature 167): `/pl/aktualnosci/porady`, `/en/news/tag/diy`.
 *
 * **This is the only place a blog URL is composed.** Every blog URL the platform
 * emits — cards, tiles, tag chips, breadcrumbs, canonical and alternate URLs, the
 * sitemap — is built here by the backend, as product URLs are by `productPath`.
 * Page 1 carries no `?page=` (it is the canonical URL). Throws on a language the
 * channel does not have.
 */
export function blogPath(
  input: BlogPathView & { languageCode: string; channel: ChannelUrlFacts; prefix: string },
): string {
  return storefrontPagePath({
    path: blogLogicalPath(input),
    languageCode: input.languageCode,
    channel: input.channel,
  });
}

/** The unprefixed blog path — the `x-default` target. */
export function blogDefaultPath(input: BlogPathView & { prefix: string }): string {
  return blogLogicalPath(input);
}

/**
 * `GET /api/v1/blog/routing` — what the storefront middleware maps the public blog
 * prefix with (feature 171, `contracts/storefront-api.md`). One channel: the resolved one.
 */
export const blogRoutingResponseSchema = z.object({
  data: z.object({
    /** `blog.url_prefix` of the channel. */
    defaultPrefix: blogUrlPrefixSchema,
    /** Every language of the channel → its effective prefix. */
    prefixes: z.record(z.string(), blogUrlPrefixSchema),
    /** Prefixes the channel served before; empty while `seo` is absent (redirects are its to serve). */
    formerPrefixes: z.array(
      z.object({
        /** `null` = a former channel default. */
        languageCode: z.string().nullable(),
        prefix: blogUrlPrefixSchema,
      }),
    ),
  }),
});
export type BlogRoutingResponse = z.infer<typeof blogRoutingResponseSchema>;
export type BlogRouting = BlogRoutingResponse['data'];

/** One row of `GET /api/v1/admin/blog/addresses` (feature 171, data-model §1.3). */
export const blogUrlPrefixRowSchema = z.object({
  id: uuidSchema,
  salesChannelId: uuidSchema,
  languageCode: z.string().nullable(),
  prefix: blogUrlPrefixSchema,
  state: z.enum(['current', 'former']),
  updatedAt: isoDateTimeSchema,
});
export type BlogUrlPrefixRow = z.infer<typeof blogUrlPrefixRowSchema>;

// ────────────────────────────────────────────────────────────────────
// Per-language URL keys — feature 171 (US4, data-model §1.1–1.2)
// ────────────────────────────────────────────────────────────────────

export const blogUrlKeyEntityKindSchema = z.enum(['post', 'category']);
export type BlogUrlKeyEntityKind = z.infer<typeof blogUrlKeyEntityKindSchema>;

/**
 * `GET /api/v1/admin/blog/{posts|categories}/:id/url-keys`. `keys` are the language
 * keys the editor set; a language without one is served at `slug`. `effective` is the
 * key and path per (channel, language) the entity is served at. `redirects` is omitted
 * while `seo` is absent — serving them is its decision.
 */
export const blogUrlKeysResponseSchema = z.object({
  slug: blogSlugSchema,
  keys: z.array(z.object({ languageCode: z.string(), key: blogSlugSchema })),
  effective: z.array(
    z.object({ salesChannelId: uuidSchema, languageCode: z.string(), key: blogSlugSchema, path: z.string() }),
  ),
  redirects: z.array(z.object({ id: uuidSchema, languageCode: z.string(), key: blogSlugSchema })).optional(),
  version: z.number().int(),
});
export type BlogUrlKeysResponse = z.infer<typeof blogUrlKeysResponseSchema>;

/**
 * `PUT …/url-keys`. Each entry sets (or, with `key: null`, removes) the key of one
 * language; languages not named are left alone. A key another entity holds as a
 * redirect is refused with `BLOG_URL_KEY_REDIRECT_TAKEOVER_REQUIRED` until the retry
 * names it in `confirmTakeover`.
 */
export const putBlogUrlKeysRequestSchema = z.object({
  keys: z.array(z.object({ languageCode: z.string().min(2), key: blogSlugSchema.nullable() })),
  confirmTakeover: z.array(z.object({ languageCode: z.string().min(2), key: blogSlugSchema })).optional(),
  version: z.number().int(),
});
export type PutBlogUrlKeysRequest = z.infer<typeof putBlogUrlKeysRequestSchema>;

/** The other languages of a post or category page, for `hreflang` and the language switcher. */
export const blogAlternatesSchema = z.object({
  /** Language code → path, for every language of the channel the entity is in. */
  languages: z.record(z.string(), z.string()),
  /** The unprefixed path of the channel's default language, when the entity is in it. */
  xDefault: z.string().nullable(),
});
export type BlogAlternates = z.infer<typeof blogAlternatesSchema>;

/** A former key or pre-171 slug of the request language: the storefront answers 301 to `path`. */
export const blogRedirectResolutionSchema = z.object({
  kind: z.literal('redirect'),
  path: z.string(),
  permanent: z.literal(true),
});
export type BlogRedirectResolution = z.infer<typeof blogRedirectResolutionSchema>;

/**
 * Feature 171 (US7) — the author on a post card: an administrator's display name and
 * avatar, and nothing else about them (no e-mail, role or status).
 */
export const blogAuthorCardSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type BlogAuthorCard = z.infer<typeof blogAuthorCardSchema>;

/** The author on the post page: the card plus the biography in the request language, else the channel default. */
export const blogAuthorSchema = blogAuthorCardSchema.extend({
  bio: z.string().nullable(),
});
export type BlogAuthor = z.infer<typeof blogAuthorSchema>;

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
  /**
   * The primary category's name in the request language (feature 163), for the
   * category chip on a post card. Optional so a card cached before it existed
   * still parses.
   */
  primaryCategoryName: z.string().nullable().optional(),
  /** Feature 171 — the storefront path, composed by {@link blogPath}. Optional so a payload cached before it existed still parses. */
  url: z.string().optional(),
  /** Feature 171 (US7) — the administrator named as author, whoever they are now. */
  authorId: uuidSchema.nullable().optional(),
  /** Feature 171 (US7) — the author, filled per request (never cached); `null` when there is none. */
  author: blogAuthorCardSchema.nullable().optional(),
});
export type BlogPostCard = z.infer<typeof blogPostCardSchema>;

/** Most cards one `GET /api/v1/blog/posts` returns (feature 163, contract §3). */
export const BLOG_POSTS_LIST_MAX_LIMIT = 24;
/** Cards returned when the request names no `limit`. */
export const BLOG_POSTS_LIST_DEFAULT_LIMIT = 6;

/**
 * `GET /api/v1/blog/posts` — the published posts of the resolved channel, newest
 * first, page by page (feature 163; paginated by feature 171, US2), optionally
 * filtered by category, tag and author. An unknown filter value yields an empty list
 * rather than a 404, so a stale block setting renders nothing.
 *
 * `perPage` is the page size; `limit` stays as its synonym for the callers written
 * before pagination, and `perPage` wins when both are sent. With neither, the page
 * size is {@link BLOG_POSTS_LIST_DEFAULT_LIMIT}, as before. A page past the last
 * answers an empty `data` with the real totals.
 */
export const blogPostsListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    perPage: z.coerce.number().int().min(1).max(BLOG_POSTS_LIST_MAX_LIMIT).optional(),
    limit: z.coerce.number().int().min(1).max(BLOG_POSTS_LIST_MAX_LIMIT).optional(),
    categorySlug: blogSlugSchema.optional(),
    tagCode: blogTagCodeSchema.optional(),
    authorId: uuidSchema.optional(),
  })
  .transform(({ perPage, limit, ...rest }) => ({
    ...rest,
    perPage: perPage ?? limit ?? BLOG_POSTS_LIST_DEFAULT_LIMIT,
  }));
export type BlogPostsListQuery = z.infer<typeof blogPostsListQuerySchema>;

export const blogPaginationSchema = z.object({
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
  totalItems: z.number().int().nonnegative(),
});
export type BlogPagination = z.infer<typeof blogPaginationSchema>;

export const blogPostsListResponseSchema = z.object({
  data: z.array(blogPostCardSchema),
  /** Feature 171 — optional so a response from a backend that predates it still parses. */
  pagination: blogPaginationSchema.optional(),
});
export type BlogPostsListResponse = z.infer<typeof blogPostsListResponseSchema>;

/**
 * @deprecated Since issue #590 — kept parseable for one minor release, then
 * removed. Read {@link blogResolvedPostSchema}'s `relatedProductIds` instead and
 * read the products from the catalogue listing (`GET /api/v1/catalog/products?ids=`),
 * which answers them **for the viewer**.
 *
 * No composition this repository ships ever filled it: it was produced only by
 * the optional `BlogStorefrontDeps.resolveProductCard`, which nothing passed, so
 * `relatedProducts` was always empty. And it could not carry a correct price:
 * the post payload is cached per (channel, language, slug) and shared by every
 * visitor, so a price resolved for one buyer would be served to all of them,
 * and the blog cache is not cleared when a price book changes.
 */
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
    .nullable()
    .describe(
      'Deprecated (issue #590). Not resolved for a buyer, not stated net or gross, never rendered by the storefront. ' +
        'The viewer price of a related product comes from the catalogue listing (`?ids=`).',
    ),
});
/** @deprecated Since issue #590 — see {@link blogProductCardSchema}. */
export type BlogProductCard = z.infer<typeof blogProductCardSchema>;

export const blogCategoryTileSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: blogSlugSchema,
  mainImageUrl: z.string().nullable(),
  /** Feature 171 — the storefront path, composed by {@link blogPath}. Optional so a payload cached before it existed still parses. */
  url: z.string().optional(),
});
export type BlogCategoryTile = z.infer<typeof blogCategoryTileSchema>;

export const blogIndexResponseSchema = z.object({
  urlPrefix: blogUrlPrefixSchema,
  /** Feature 171 — the storefront path, composed by {@link blogPath}. Optional so a payload cached before it existed still parses. */
  url: z.string().optional(),

  /** @deprecated Since feature 171 — equals `posts.data`; read `posts`. */
  latestPosts: z.array(blogPostCardSchema),
  /** Feature 171 — the index's page of posts. Optional so a payload cached before it existed still parses. */
  posts: z.object({ data: z.array(blogPostCardSchema), pagination: blogPaginationSchema }).optional(),
  topLevelCategories: z.array(blogCategoryTileSchema),
});
export type BlogIndexResponse = z.infer<typeof blogIndexResponseSchema>;

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
  /** Feature 171 — the storefront path, composed by {@link blogPath}. Optional so a payload cached before it existed still parses. */
  url: z.string().optional(),
  /** Feature 171 — the category in the channel's other languages. */
  alternates: blogAlternatesSchema.optional(),
});
export type BlogResolvedCategory = z.infer<typeof blogResolvedCategorySchema>;

export const blogResolvedTagRefSchema = z.object({
  id: uuidSchema,
  code: blogTagCodeSchema,
  name: z.string(),
  /** Feature 171 — the storefront path, composed by {@link blogPath}. Optional so a payload cached before it existed still parses. */
  url: z.string().optional(),
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
  /** @deprecated Since issue #590 — always empty in a shipped composition; read `relatedProductIds`. */
  relatedProducts: z.array(blogProductCardSchema),
  /**
   * Issue #590 — the post's related products, by id, in the order the editor
   * gave them. **Ids only, nothing about the viewer**, which is what makes the
   * field safe in the post payload's shared cache.
   *
   * Price provenance: the payload carries no price. The storefront reads these
   * products from the catalogue listing (`GET /api/v1/catalog/products?ids=`,
   * at most `PRODUCT_LIST_MAX_IDS`) as the viewer, so each card's price is the
   * one any listing card shows that viewer — resolved by the pricing engine for
   * the request's sales channel, currency and buyer (organisation and customer
   * account), net, with the display mode that says how to show it. A product
   * the viewer may not see is not in that answer and is not shown.
   *
   * Optional so a payload cached before it existed still parses.
   */
  relatedProductIds: z.array(uuidSchema).optional(),
  categories: z.array(
    z.object({ id: uuidSchema, name: z.string(), slug: blogSlugSchema }),
  ),
  breadcrumb: z.array(blogBreadcrumbEntrySchema),
  /** Feature 171 — the storefront path, composed by {@link blogPath}. Optional so a payload cached before it existed still parses. */
  url: z.string().optional(),
  /** Feature 171 — the post in the channel's other languages. */
  alternates: blogAlternatesSchema.optional(),
  /** Feature 171 (US7) — the administrator named as author, whoever they are now. */
  authorId: uuidSchema.nullable().optional(),
  /** Feature 171 (US7) — the author, filled per request (never cached); `null` when there is none. */
  author: blogAuthorSchema.nullable().optional(),
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
  // Feature 171 — a former key, or a pre-171 slug of a language that has its own key.
  blogRedirectResolutionSchema,
]);
export type BlogBySlugResponse = z.infer<typeof blogBySlugResponseSchema>;

export const blogTagByCodeResponseSchema = z.object({
  tag: z.object({
    id: uuidSchema,
    code: blogTagCodeSchema,
    name: z.string(),
    description: z.string().nullable(),
    /** Feature 171 — the storefront path, composed by {@link blogPath}. Optional so a payload cached before it existed still parses. */
    url: z.string().optional(),
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
  URL_PREFIX_BY_LANGUAGE: 'blog.url_prefix_by_language',
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
  // Feature 171 — the blog's own fixed sub-segments (OR-6): `/<prefix>/tag/…` and the
  // reserved `/<prefix>/author/…` would read as a prefix of their own.
  'tag',
  'author',
  'api',
  '_next',
  'manifest.webmanifest',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
]);
