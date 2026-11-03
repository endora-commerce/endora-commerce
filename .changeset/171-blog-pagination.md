---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-blog': minor
---

`GET /api/v1/blog/posts` pages its posts (feature 171, US2): `page` (default 1) and `perPage`
(1–24) — `limit` stays as its synonym, and a request naming neither keeps today's page size of 6.
The response gains `pagination` (`page`, `perPage`, `totalItems`, `totalPages`) beside `data`; a page
past the last answers an empty `data` with the real totals. New filters `tagCode` and `authorId`
combine with `categorySlug`. The order has a stable tie-breaker (`published_at`, `created_at`, `id`),
so pages never repeat or skip a post.

`GET /api/v1/blog/by-channel` takes `page` and answers `posts: { data, pagination }`, paged by
`blog.posts_per_page`; `topLevelCategories` is filled on page 1 only, and `latestPosts` is deprecated
(it equals `posts.data`). `blog.latest_count` now sizes only the *Latest posts* page-builder block.
The storefront blog index is paged, and a page number past the last is a 404 on the index, a category
and a tag.

`@endora-commerce/contracts`: `blogPostsListQuerySchema` gains `page`, `perPage`, `tagCode` and
`authorId` and resolves `perPage`; `blogPostsListResponseSchema.pagination`;
`blogIndexResponseSchema.posts`.
