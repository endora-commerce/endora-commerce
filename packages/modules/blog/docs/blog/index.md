---
title: Blog
sidebar_position: 16
description: Editorial Posts with Page Builder bodies, taxonomy (Categories + Tags), and storefront feeds
---

# Blog

The Blog module owns the storefront's editorial blog surface — Posts,
Categories, and Tags — composed in the same drag-and-drop **Page
Builder** that ships with the [CMS module](../cms/index.md). Posts
inherit the CMS Page's field shape (slug, status lifecycle, per-language
content, SEO meta) and add blog-specific affordances: a parent Category
tree, free-form Tags, ordered Related Posts, and ordered Related
Products.

| Entity         | Identifier             | Lifecycle                            | Embedded by                                              |
| -------------- | ---------------------- | ------------------------------------ | -------------------------------------------------------- |
| **Post**       | `slug` (per channel)   | `draft → published → archived`       | URL `<blog-prefix>/<slug>` on the storefront             |
| **Category**   | `slug` (per channel)   | `enabled` flag, tree-structured      | URL `<blog-prefix>/<slug>` (siblings of Posts) and tiles |
| **Tag**        | `code` (global)        | block-on-delete                      | URL `<blog-prefix>/tag/<code>` and per-Post chip strip   |

## Entities and the reference graph

```
   blog_categories  ── parent_id ──┐ self-FK tree (NO ACTION)
                          │       ▼
                          ├─── blog_post_categories ───────► blog_posts
                          │                                       │
                          │                              ┌────────┼─────────┐
                          ▼                              ▼        ▼         ▼
              blog_post_categories                  blog_post_tags  blog_post_related_posts (self-FK)
                                                          │                  │
                                                          ▼                  │
                                                      blog_tags              │
                                                                             ▼
                                                              blog_post_related_products → catalog.products
```

The schema lives in `20260506T081055_blog_init.ts` (eleven new tables, all
prefixed `blog_*`) and never touches existing tables. Migration
`20261023T063013_blog_post_main_image.ts` adds `blog_posts.main_image_asset_id`
(nullable, referencing `assets`).

## Main image

A post has an optional **Main image**, chosen from the Assets Library in the
post editor. It is shown on post cards — the blog index, category and tag
lists, and the Page Builder's latest-posts block. The admin API carries it as
`mainImageAssetId` (create, patch and detail), and storefront cards as
`mainImageUrl`, which is the public URL of the asset or `null` when the post
has none or the asset is not public.

## URLs and routing

The storefront serves the blog from one Next.js catch-all,
`storefront/app/blog/[[...slug]]/page.tsx`. The public address is the channel's
`blog.url_prefix` from the [Settings module](../settings/index.md): the storefront
middleware reads the channel's blog routing (`GET /api/v1/blog/routing`, held for a
minute per channel) and maps `/<prefix>/…` onto that route, after the language prefix
the channel's URL setting adds (`/pl/aktualnosci/…`). The routes are:

| URL pattern (after channel resolution) | Renders                              |
| -------------------------------------- | ------------------------------------ |
| `/<prefix>`                            | Blog index — latest N + first-level Categories |
| `/<prefix>/tag/<code>`                 | Tag view — paginated cards for the Tag |
| `/<prefix>/<slug>`                     | Category page (if the slug matches a `blog_categories.slug`) |
| `/<prefix>/<slug>`                     | Post page (if the slug matches a `blog_posts.slug`) |

When the prefix is not `blog`, a request for `/blog/…` answers **301** to the same view
under the prefix, and so does a request for any **former prefix** of the channel while
the SEO module is on — renaming the blog's address does not break a link anyone kept.
The blog records every prefix a channel has served; a former prefix can be forgotten
(`DELETE /api/v1/admin/blog/addresses/:id`), after which it stops redirecting.

Every blog URL a storefront payload carries — post cards, category tiles, tag chips,
breadcrumbs, the post's own `url` — is composed by the backend with `blogPath` from
`@endora-commerce/contracts`, so it already carries the language prefix and the blog
prefix. The storefront builds none of its own.

The dispatch resolution happens in **one** backend call — `GET /api/v1/blog/by-slug?slug=…` — which returns a discriminated union (`{ kind: 'category' | 'post', … }`). Two channels MAY use the same slug for unrelated entities (channel context disambiguates).

### Slug uniqueness

Slug uniqueness is enforced **per `(sales_channel, slug)` across the
union of `blog_posts` and `blog_categories`**:

- DB-level partial unique indexes on each scope row (`*_sales_channels`)
  catch any application bug that bypasses the service-level check.
- The `BlogSlugCollision.assertSlugAvailable` helper acquires a
  Postgres `pg_advisory_xact_lock` per `(channel, slug)` so a concurrent
  save cannot squeeze a duplicate past the per-table indexes.
- The literal `tag` is reserved as a slug (would collide with the
  `<prefix>/tag/<code>` URL pattern).

## Lifecycle

### Posts

```
draft ─── publish ────► published ─── unpublish ───► draft
                            │                           │
                            │ archive                   │
                            ▼                           ▼
                        archived  ◄── unarchive ── (admin)
```

`published_at` is set on the first transition to `published` and
preserved across subsequent unpublish / archive transitions (so re-
publishing a post does not reset its publication date). A Post renders
on the storefront when:

```
status = 'published'
AND active = true
AND deleted_at IS NULL
AND requested-channel ∈ post.salesChannels
AND blog.enabled[channel] = true
```

### Categories

Categories carry a single `enabled` flag (no draft / publish). The seeded
`Default` row is system-protected — admins can rename it, change its
metadata, or detach it from channels, but it cannot be deleted.

## Reference protection

Five guards block destructive operations:

1. **Tag delete with referencing posts** → 409 `BLOG_TAG_IN_USE`.
2. **Category delete with referencing posts** → 409 `BLOG_CATEGORY_IN_USE`.
3. **Category delete with child rows** → 409 `BLOG_CATEGORY_HAS_CHILDREN`.
4. **Seeded `Default` Category delete** → 409 `BLOG_CATEGORY_PROTECTED`.
5. **Library Asset soft-delete while embedded in a Post body or Category description, or used as a Post's main image** →
   409 `ASSET_REFERENCED` (descriptors registered with the
   [Assets Library reference registry](../assets-library/index.md#asset-reference-registry)).

The Post-as-Related-Post relationship uses a different contract:
**detach-on-delete**. When a Post is soft-deleted, every parent Post's
`relatedPostIds` shrinks atomically. The admin sees a confirmation
dialog listing the affected parents (driven by the
`/posts/:id/inbound-references` probe).

The Post-as-Related-Product relationship uses **soft-delete-+-storefront-filter**: a soft-deleted product is invisible on the next storefront read; the join row remains. A generic `ProductReferenceRegistry` may ship in a follow-up.

### Related products on the storefront

The post payload of `GET /api/v1/blog/by-slug` names its related products **by id only** —
`relatedProductIds`, in the order the editor saved — because the payload is cached per sales
channel and language for every visitor, so it carries nothing about one.

The storefront reads those products in **one** catalogue listing read, as the visitor:
`GET /api/v1/catalog/products?ids=…` (at most 24, the first ones of the post). Each card is
therefore the product card a catalogue listing shows that visitor:

- only the products the visitor may see on the channel — a deleted, unpublished,
  out-of-channel or restricted product is left out, and the others keep the post's order;
- the price the pricing engine resolves for the visitor — the sales channel, the selected
  currency, the organisation and the customer account — shown net, gross or both according to
  the display mode, or *Price on request* when the display mode is `none`, and formatted for the
  page language.

The strip is not shown when the post links no product the visitor may see, or while the
catalogue is not present. The older `relatedProducts` field (`BlogProductCard`) is deprecated:
no composition ever filled it, and it will be removed in a later minor release.

## Settings

| Code                  | Type    | Default | Notes                                                |
| --------------------- | ------- | ------: | ---------------------------------------------------- |
| `blog.enabled`        | boolean | `true`  | Disables the namespace per channel.                  |
| `blog.url_prefix`     | string  | `blog`  | Single URL segment, `^[a-z0-9-]+$`. See *The blog's address* below. |
| `blog.url_prefix_by_language` | json | `{}` | A prefix per language, overriding `blog.url_prefix` for it: `{"pl-PL": "aktualnosci", "en-US": "news"}`. |
| `blog.latest_count`   | number  | `5`     | Default size of the *Latest posts* page-builder block. |
| `blog.posts_per_page` | number  | `12`    | Page size of the blog index, Category and Tag views. |

A change to any `blog.*` setting drops the platform-wide settings cache at the
write seam and then fires an `EventBus` event, which wipes the storefront cache
(see Cache strategy below).

### The blog's address

A `blog.url_prefix` write is judged by the blog itself, through the Settings module's
write validators, on the Settings screen and the Settings API alike. It is refused when
the value:

- is not one lower-case segment of letters, digits and hyphens — `400 BLOG_URL_PREFIX_INVALID`;
- is a reserved storefront segment: `api`, `tag`, `author` and the other segments the
  blog reserves, or one of the deployment's `cms.reserved_slug_segments` —
  `409 BLOG_URL_PREFIX_RESERVED`;
- is the language prefix of any sales channel (`pl`, `en`, …) or the first slug segment
  of a CMS page in the channel — `409 BLOG_URL_PREFIX_CONFLICT`.

`blog` itself is always accepted. The other way round, a CMS page whose slug starts with
a channel's current or former blog prefix is refused with `409 CMS_SLUG_RESERVED`
(`claimedBy: "blog"`) — while the blog module is switched off it claims nothing.

### A prefix per language

`blog.url_prefix_by_language` gives a language a prefix of its own — `/pl/aktualnosci/…`
and `/en/news/…` in one channel — and is judged by the same rules, per language; a
language the channel does not have is refused with `400 BLOG_URL_PREFIX_INVALID`. A
language without an entry uses `blog.url_prefix`. Requesting the blog in a language under
another language's prefix answers `301` to the right one. Every prefix a language has
served is kept as a former address, as for the channel default.

**Blog → Addresses** in the admin lists, per sales channel, the current prefixes and the
former ones, and forgets a former one.

## Languages

A post or a category exists on the storefront in the languages assigned to it. Requested
in another language it answers `404`, and no list in that language — the index, a category,
a tag, `/posts`, related posts, a card's category chip, a post's breadcrumb — shows it. The
request language is matched to the channel's own first (`en` finds `en-US`). A category
assigned no language at all — the seeded `Default` — is in every one.

So that a published post is written in each of its languages, publishing it, and saving a
published one, is refused with `422 BLOG_LANGUAGE_INCOMPLETE` when an assigned language has
no name — or no content, once the post has content in any language. The details name each
missing `<field>.<language>`. A draft may be incomplete. A category needs a name in each of
its languages on every save.

## Addresses per language

A post or a category can have a **URL key per language** — `jak-wybrac-wiertarke` in Polish,
`how-to-choose-a-drill` in English — set in the editor's **Address** card of the language
being edited. A language without a key is served at the base slug. A key:

- resolves only in its own language;
- is unique per sales channel and language across posts **and** categories
  (`409 BLOG_URL_KEY_TAKEN`); the same key in another language is free;
- leaves a **redirect** behind when it is replaced, and the base slug of a language with a
  key of its own redirects too — redirects point at the entry, never at a key, so they never
  chain, and they are served only while the SEO module is on;
- may take over another entry's redirect only once the editor confirms it
  (`409 BLOG_URL_KEY_REDIRECT_TAKEOVER_REQUIRED`, then the same `PUT` with `confirmTakeover`).

Changing a base slug keeps the former slug answering as a redirect in every language without
a key. A post's and category's answers carry `alternates` — the path in each of the channel's
languages it is in — which the storefront writes as `hreflang` links and uses for the
language switcher. Every key write is one audited command (`blog.url_keys.update`,
`blog.url_redirect.delete`).

## Authors

A post can name one **author**: an administrator, chosen in the editor among the active
ones (`GET /api/v1/admin/blog/author-candidates`, `blog.write` — no administrator rights
needed; it answers names and avatars only). The storefront shows the author's name, avatar
and *about me* in the page language (else the channel default) on the post page, the name
on cards, and the author as a `Person` in the post's structured data. The author's avatar
and *about me* are edited on the administrator's own profile page (see the `admin_users`
module). An inactive administrator is still shown as the author; a deleted one is not, and
nothing of them is kept on the post. The post payload is cached with the author's id only,
so a profile edit shows at once. `GET /api/v1/blog/posts?authorId=…` lists one author's posts.

## Admin roles

Two roles seed at first boot through `services/seed-roles.ts`:

| Code              | Default name      | Permissions                                          |
| ----------------- | ----------------- | ---------------------------------------------------- |
| `blog_manager`    | Blog Manager      | `blog.read`, `blog.write`                            |
| `content_manager` | Content Manager   | `blog.read`, `blog.write`, `cms.read`, `cms.write`   |

Both are **system-protected**: `AdminRoleService.remove` refuses delete
with 409 `ADMIN_ROLE_PROTECTED`. The reconciler preserves admin-edited
names across reboots and only refreshes the canonical permissions
array if it has drifted.

## Storefront API

| Method | Path                                  | Returns                                                  |
| ------ | ------------------------------------- | -------------------------------------------------------- |
| GET    | `/api/v1/blog/by-channel?page=…`      | `BlogIndexResponse` — a page of posts (`posts.data`, `posts.pagination`) by `posts_per_page`, first-level Categories on page 1 |
| GET    | `/api/v1/blog/by-slug?slug=…`         | Discriminated `BlogBySlugResponse` (category / post)     |
| GET    | `/api/v1/blog/tag-by-code?code=…`     | `BlogTagByCodeResponse` — paginated posts for the Tag    |
| GET    | `/api/v1/blog/posts?page=…&perPage=…&categorySlug=…&tagCode=…&authorId=…` | `{ data: BlogPostCard[], pagination }` — published posts, newest first, page by page |
| GET    | `/api/v1/blog/routing`                | `BlogRoutingResponse` — the channel's prefix per language and its former prefixes; `404 BLOG_DISABLED` when the blog is disabled in the channel |

Admin, for the blog's addresses: `GET /api/v1/admin/blog/addresses?salesChannelId=…`
(`blog.read`) lists the current and former prefixes, and
`DELETE /api/v1/admin/blog/addresses/:id` (`blog.write`) forgets a former one — an
audited `blog.url_prefix.forget` command.

`/posts` feeds the latest-posts block and any headless client. `perPage` (or its
older name `limit`) is 1–24, default 6; a larger value answers `400`. `pagination` gives
`page`, `perPage`, `totalItems` and `totalPages`; a page past the last answers an empty list
with the real totals (the storefront's own pages answer `404` there). The filters combine. An unknown `categorySlug` answers an empty list rather
than a 404, so a block whose category was removed simply shows nothing. A
channel with `blog.enabled = false` also answers an empty list. Each card
carries `mainImageUrl`, `primaryCategoryName` (the category chip) and `url`
(`/<blog-prefix>/<slug>`).

All four:

- read the resolved channel + language from request headers (`x-sales-channel`, `x-blog-language` / `accept-language`);
- read `blog.*` settings from the channel-aware Settings service;
- return `404 BLOG_DISABLED` (or `BLOG_POST_NOT_FOUND` / `BLOG_TAG_NOT_FOUND`) when the resolved scope has no matching content — except `/posts`, which answers an empty list;
- ride the [`BlogCacheService`](#cache-strategy) Redis read-through.

## Cache strategy

Keys live under `blog:v1:<channelCode>:<language>:` with five shapes:

```
blog:v1:<channel>:<language>:index
blog:v1:<channel>:<language>:category:<slug>:p<page>
blog:v1:<channel>:<language>:post:<slug>
blog:v1:<channel>:<language>:tag:<code>:p<page>
blog:v1:<channel>:<language>:list:<categorySlug|*>:n<limit>
```

TTL: 5 minutes (aligned with the CMS module's cache).

Invalidation:

| Event                                  | Wipe                                            |
| -------------------------------------- | ----------------------------------------------- |
| Post / Category / Tag write            | `BlogCacheService.invalidateAll()`              |
| Soft-delete or settings write          | `BlogCacheService.invalidateAll()` via EventBus |

The granular `invalidatePost(channelCode, slug)` and friends are wired
on the cache class for future surgical-invalidation work (coarse
invalidation is correct at v1; rate of writes is low).

## Page Builder block: latest posts

The blog module declares one Page Builder block, `blog.LatestPosts` (palette
section *Content*), which shows the newest published posts of the page's sales
channel in the page's language:

| Option | Meaning |
| --- | --- |
| Header | An optional heading, lead text and button above the posts. |
| Number of posts | How many posts, 1–12 (default 6). On the **Data** tab. |
| Category | Only posts of this category; empty for all. On the **Data** tab, picked from the blog's categories (the block keeps storing the category's slug, so a block saved before is unchanged). |
| Layout | Carousel (with the carousel options: slides per view per breakpoint, gap, effect, arrows and dots) or grid (columns per breakpoint). |
| Read-more label | The text of the link on each card. |

Each card shows the main image (2:1), the primary category, the title and the
read-more link.

**Card and header look.** Each of these options is unset by default, which
keeps the card described above; the ones marked *per breakpoint* are set on the
**Responsive** tab, a breakpoint left unset showing the default.

| Option | Meaning |
| --- | --- |
| Card background | A brand colour or a hex value behind the whole card; unset, the section's background. |
| Rounded corners | The card's corners: none, small, medium (the default, 8 px) or large. |
| Card padding | Space around the card's image and text, a spacing step or Custom (px) — *per breakpoint*. |
| Text padding | Space above and beside the text under the image — *per breakpoint*; unset, 16 px above and none beside. |
| Image ratio | The image frame's proportions, a preset or Custom (`w:h`) — *per breakpoint*. |
| Zoom on hover | The image grows slightly while the card is hovered or focused (not with reduced motion). |
| Category chip | Filled (the default), outline or hidden. |
| Card title size / weight | A type size or Custom (px), and a weight — *per breakpoint*. |
| Read-more icon / alignment / weight | An arrow or a plus after the label, the link at the start or the end of the card, and its weight. |
| Lead size / colour | The header lead's size (*per breakpoint*) and colour. |
| Header button placement | Below the lead (the default), at the end of the header (level with the lead) or after the posts and their controls — *per breakpoint*. |
| Header button width | Fit the label or full width — *per breakpoint*. | The posts are read on the server through
`GET /api/v1/blog/posts`, so they are in the page's HTML. With no posts,
customers see nothing and the editor preview shows "No posts". Like every
section block, it carries the section settings (anchor, colour scheme,
background, spacing, width) at the top level of a page. Its header and
read-more texts are translatable with the Page Builder's **Translate** action.

While the blog module is switched off, the block is not offered in the
palette, a stored one renders nothing, `/api/v1/blog/posts` does not answer,
and the storefront does not ask for posts.

## Cross-module dependencies

| Module                                       | What the blog reads                                         |
| -------------------------------------------- | ----------------------------------------------------------- |
| [Settings](../settings/index.md)             | Four `blog.*` settings via `settings.service.get`           |
| [Sales Channels](../sales_channels/index.md) | Channel resolution + language fallback                |
| [Assets Library](../assets-library/index.md) | Asset URL signing + reference registry                |
| [CMS](../cms/index.md)                       | Page Builder envelope (`cmsContentEnvelopeSchema`)          |
| [Catalog](../catalog.md)                     | Nothing: the storefront reads Related Products from the public listing (`?ids=`) as the visitor |

The blog module never imports another module's internals — every cross-module read goes through a documented service port.
