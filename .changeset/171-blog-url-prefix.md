---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-blog': minor
'@endora-commerce/mod-cms': minor
---

**Operator note:** a blog URL prefix set per sales channel (`blog.url_prefix`) now takes effect on
the storefront. Until now the storefront served the blog at `/blog` whatever the setting said, while
the sitemap and the breadcrumbs used the setting — links that answered 404. After the upgrade the
blog is served under the prefix, and `/blog/…` answers `301` to the same page under it. A channel
left on `blog` sees no change. Feature 171 (`specs/171-blog-i18n-authors/`, US1).

`blog.url_prefix` writes are now judged, on the Settings screen and the Settings API: a prefix that
is malformed (`400 BLOG_URL_PREFIX_INVALID`), reserved (`api`, `tag`, `author`, the deployment's
`cms.reserved_slug_segments` — `409 BLOG_URL_PREFIX_RESERVED`), a language prefix of any channel or
the first slug segment of a CMS page in the channel (`409 BLOG_URL_PREFIX_CONFLICT`) is refused. The
rule existed as `BlogSettingsResolver.assertValidPrefix`, which nothing called; that static method is
removed. A stored value that would now be refused keeps working until it is next changed.

The blog records every prefix a channel has served (`blog_url_prefixes`), and a former prefix
answers `301` to the current one while the SEO module is present. `GET /api/v1/blog/routing` answers
the channel's prefix per language and its former prefixes — the read the storefront middleware maps
the prefix with. `GET /api/v1/admin/blog/addresses` lists them and
`DELETE /api/v1/admin/blog/addresses/:id` forgets a former one (`blog.url_prefix.forget`).

`@endora-commerce/contracts`:

- `blogPath(input)` / `blogDefaultPath(input)` and the `BlogPathView` type — the one place a blog
  URL is composed, on top of `storefrontPagePath`.
- Every storefront blog payload gains an optional `url` — post cards, category tiles, tag
  references, the resolved post and category, the index and the tag page's tag. Breadcrumb URLs
  now carry the language prefix of the request language (feature 167) and the blog prefix.
- `blogRoutingResponseSchema` / `BlogRouting`, `blogUrlPrefixRowSchema` / `BlogUrlPrefixRow`.
- `ERROR_CODES.BLOG_URL_PREFIX_CONFLICT`, `ERROR_CODES.BLOG_URL_PREFIX_NOT_FOUND`;
  `BLOG_RESERVED_URL_PREFIXES` gains `tag` and `author`.
- `CmsPageReadPort.firstSegmentsInChannel(salesChannelId)` — an implementer of the port must add it.
- `CmsReservedSegmentContributor` and `CmsReservedSegmentRegistryPort`.

`@endora-commerce/mod-cms`: a module can claim first path segments per channel through the new
`cmsReservedSegmentRegistry`; a page slug starting with a claimed segment is refused with
`409 CMS_SLUG_RESERVED` and `details.claimedBy`. A switched-off contributor claims nothing.
