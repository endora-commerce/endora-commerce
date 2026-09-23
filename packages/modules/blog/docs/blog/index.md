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

The schema lives entirely in `037_blog_init.ts` (eleven new tables, all
prefixed `blog_*`) and never touches existing tables.

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
5. **Library Asset soft-delete while embedded in a Post body or Category description** →
   409 `ASSET_REFERENCED` (descriptors registered with the
   [Assets Library reference registry](../assets-library/index.md#asset-reference-registry)).

The Post-as-Related-Post relationship uses a different contract:
**detach-on-delete**. When a Post is soft-deleted, every parent Post's
`relatedPostIds` shrinks atomically. The admin sees a confirmation
dialog listing the affected parents (driven by the
`/posts/:id/inbound-references` probe).

The Post-as-Related-Product relationship uses **soft-delete-+-storefront-filter**: a soft-deleted product is invisible on the next storefront read; the join row remains. A generic `ProductReferenceRegistry` may ship in a follow-up.

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

All three:

- read the resolved channel + language from request headers (`x-sales-channel`, `x-blog-language` / `accept-language`);
- read `blog.*` settings from the channel-aware Settings service;
- return `404 BLOG_DISABLED` (or `BLOG_POST_NOT_FOUND` / `BLOG_TAG_NOT_FOUND`) when the resolved scope has no matching content;
- ride the [`BlogCacheService`](#cache-strategy) Redis read-through.

## Cache strategy

Keys live under `blog:v1:<channelCode>:<language>:` with four shapes:

```
blog:v1:<channel>:<language>:index
blog:v1:<channel>:<language>:category:<slug>:p<page>
blog:v1:<channel>:<language>:post:<slug>
blog:v1:<channel>:<language>:tag:<code>:p<page>
```

TTL: 5 minutes (aligned with the CMS module's cache).

Invalidation:

| Event                                  | Wipe                                            |
| -------------------------------------- | ----------------------------------------------- |
| Post / Category / Tag write            | `BlogCacheService.invalidateAll()`              |
| Soft-delete or settings write          | `BlogCacheService.invalidateAll()` via EventBus |

The granular `invalidatePost(channelCode, slug)` and friends are wired
on the cache class for future surgical-invalidation work (R9 — coarse
invalidation is correct at v1; rate of writes is low).

## Cross-module dependencies

| Module                                       | What the blog reads                                         |
| -------------------------------------------- | ----------------------------------------------------------- |
| [Settings (004)](../settings/index.md)       | Four `blog.*` settings via `settings.service.get`           |
| [Sales Channels (005)](../sales_channels/index.md) | Channel resolution + language fallback                |
| [Assets Library (013)](../assets-library/index.md) | Asset URL signing + reference registry                |
| [CMS (014)](../cms/index.md)                 | Page Builder envelope (`cmsContentEnvelopeSchema`)          |
| [Catalog (002)](../catalog.md)               | Product card resolution for Related Products                |

The blog module never imports another module's internals — every cross-module read goes through a documented service port.

## See also

Feature artefacts for this module, cited as repository paths rather than links:

- Specification — `specs/016-blog/spec.md`
- Implementation plan — `specs/016-blog/plan.md`
- Data model — `specs/016-blog/data-model.md`
- Contracts — `specs/016-blog/contracts/`
