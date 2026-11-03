# Contract: Storefront blog API

Schemas live in `packages/contracts/src/blog.ts` (Principle II). Every change below is **additive**;
deprecated fields stay parseable for one minor release. Every endpoint reads only the resolved sales
channel (Principle XII) and answers as today when the blog is off (Principle XVII).

## Shared shapes

```ts
// New
blogAuthorCardSchema = z.object({
  id: uuidSchema,
  name: z.string(),                 // "<firstName> <lastName>"
  avatarUrl: z.string().nullable(), // public asset URL, else null
});
blogAuthorSchema = blogAuthorCardSchema.extend({
  bio: z.string().nullable(),       // request language → channel default → null (OR-3)
});
blogAlternatesSchema = z.object({
  languages: z.record(z.string(), z.string()), // languageCode → path, assigned languages of the channel only
  xDefault: z.string().nullable(),
});
blogRedirectResolutionSchema = z.object({
  kind: z.literal('redirect'),
  path: z.string(),                 // fully prefixed (167 + blog prefix + key)
  permanent: z.literal(true),
});

// Changed (fields added, all optional for cached payloads that predate them)
blogPostCardSchema += { url: z.string().optional(), author: blogAuthorCardSchema.nullable().optional() }
blogCategoryTileSchema += { url: z.string().optional() }
blogResolvedTagRefSchema += { url: z.string().optional() }
blogResolvedPostSchema += {
  url: z.string().optional(),
  author: blogAuthorSchema.nullable().optional(),
  alternates: blogAlternatesSchema.optional(),
}
blogResolvedCategorySchema += { url: z.string().optional(), alternates: blogAlternatesSchema.optional() }
```

Every `url` and breadcrumb `url` is built by `blogPath` (see `routing-and-settings.md`) and already
carries the 167 language prefix and the blog prefix of the request language.

## `GET /api/v1/blog/posts` (changed) — US2

Query (`blogPostsListQuerySchema`):

| Param | Type | Notes |
| --- | --- | --- |
| `page` | int ≥ 1 | default 1 |
| `perPage` | int 1–24 | default 6 when `limit` also absent |
| `limit` | int 1–24 | synonym of `perPage`; `perPage` wins when both are sent |
| `categorySlug` | slug | unchanged; unknown → empty list, not 404 |
| `tagCode` | tag code | **new**; unknown → empty list |
| `authorId` | uuid | **new**; unknown → empty list |

Response (`blogPostsListResponseSchema`):

```ts
{ data: BlogPostCard[], pagination: { page, perPage, totalItems, totalPages } }  // pagination is new
```

A page past the last answers `data: []` with the real totals (never 404). Only posts assigned to the
request language are counted or returned (US3).

## `GET /api/v1/blog/by-channel` (changed) — US2

New query `page` (int ≥ 1, default 1). Response adds:

```ts
posts: { data: BlogPostCard[], pagination: BlogPagination },   // new
latestPosts: BlogPostCard[],         // deprecated — equals posts.data
topLevelCategories: BlogCategoryTile[],  // [] on pages ≥ 2
urlPrefix: string,                   // the effective prefix of the request language
url: string,                         // the index path for this language (new)
alternates: BlogAlternates,          // new
```

## `GET /api/v1/blog/by-slug` (changed) — US3, US4

`slug` is now looked up as a **key of the request language** (data-model §5). The response union gains
the redirect member:

```ts
blogBySlugResponseSchema = z.discriminatedUnion('kind', [category, post, redirect])
```

| Situation | Answer |
| --- | --- |
| key resolves to a post/category assigned to the language | 200 `{ data: { kind: 'post' \| 'category', … } }` |
| former key or pre-feature slug, `seo` present | 200 `{ data: { kind: 'redirect', path, permanent: true } }` |
| entity not assigned to the language, unknown key, `seo` absent for a redirect | 404 `BLOG_POST_NOT_FOUND` |
| `page` past the last page of a category | 200 with `posts.data: []` (the storefront maps to 404) |

## `GET /api/v1/blog/tag-by-code` (changed)

Tag and its posts filtered by the request language; cards carry `url` and `author`.

## `GET /api/v1/blog/routing` (new) — US1, US5

Read by the storefront middleware (cached 60 s per process and channel).

```ts
blogRoutingResponseSchema = z.object({
  data: z.object({
    defaultPrefix: z.string(),                       // blog.url_prefix
    prefixes: z.record(z.string(), z.string()),      // languageCode → effective prefix, every channel language
    formerPrefixes: z.array(z.object({               // [] while seo is absent
      languageCode: z.string().nullable(),           // null = former channel default
      prefix: z.string(),
    })),
  }),
});
```

404 `BLOG_DISABLED` when `blog.enabled` is false for the channel; 503 `MODULE_DISABLED` while the module
is off — the middleware treats both as "no blog routing".

## Error codes (new, `ERROR_CODES`)

| Code | Status | When |
| --- | --- | --- |
| `BLOG_URL_KEY_TAKEN` | 409 | a key is a current key of another entity at (channel, language); details `{ conflicts: [{ languageCode, key, salesChannelId, heldBy: { kind, id, name } }] }` |
| `BLOG_URL_KEY_REDIRECT_TAKEOVER_REQUIRED` | 409 | a key is another entity's redirect; details `{ takeovers: [{ languageCode, key, losing: { kind, id, name } }] }` |
| `BLOG_URL_REDIRECT_NOT_FOUND` | 404 | deleting an unknown redirect |
| `BLOG_LANGUAGE_INCOMPLETE` | 422 | publish guard; details `[{ path: '<field>.<language>', issue }]` |
| `BLOG_URL_PREFIX_CONFLICT` | 409 | prefix equals a language prefix, a CMS page segment or another claimed segment; details name the conflict |
| `BLOG_AUTHOR_NOT_FOUND` | 422 | `authorAdminUserId` names no active administrator |

Existing `BLOG_URL_PREFIX_INVALID` / `BLOG_URL_PREFIX_RESERVED` are now actually raised (research F1).
