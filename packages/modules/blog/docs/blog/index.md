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

The storefront mounts a single Next.js catch-all under
`storefront/app/(blog)/[[...slug]]/page.tsx`. The matcher reads the
channel-resolved `blog.url_prefix` from the [Settings module](../settings/index.md)
and dispatches:

| URL pattern (after channel resolution) | Renders                              |
| -------------------------------------- | ------------------------------------ |
| `/<prefix>`                            | Blog index — latest N + first-level Categories |
| `/<prefix>/tag/<code>`                 | Tag view — paginated cards for the Tag |
| `/<prefix>/<slug>`                     | Category page (if the slug matches a `blog_categories.slug`) |
| `/<prefix>/<slug>`                     | Post page (if the slug matches a `blog_posts.slug`) |

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
| `blog.url_prefix`     | string  | `blog`  | Single URL segment, `^[a-z0-9-]+$`. Reserved Next.js segments refused. |
| `blog.latest_count`   | number  | `5`     | Latest posts on the index.                           |
| `blog.posts_per_page` | number  | `12`    | Page size on Category and Tag views.                 |

A change to any `blog.*` setting drops the platform-wide settings cache at the
write seam and then fires an `EventBus` event, which wipes the storefront cache
(see Cache strategy below).

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
| GET    | `/api/v1/blog/by-channel`             | `BlogIndexResponse` — latest N + first-level Categories  |
| GET    | `/api/v1/blog/by-slug?slug=…`         | Discriminated `BlogBySlugResponse` (category / post)     |
| GET    | `/api/v1/blog/tag-by-code?code=…`     | `BlogTagByCodeResponse` — paginated posts for the Tag    |
| GET    | `/api/v1/blog/posts?limit=…&categorySlug=…` | `{ data: BlogPostCard[] }` — the newest published posts, newest first |

`/posts` feeds the latest-posts block. `limit` is 1–24 (default 6); a larger
value answers `400`. An unknown `categorySlug` answers an empty list rather
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
