---
'@endora-commerce/contracts': major
---

`cms-pages.ts` is removed. The barrel no longer exports `cmsPageSchema`, `CmsPage`,
`cmsPagePathSchema`, `upsertCmsPageRequestSchema`, `UpsertCmsPageRequest` or
`updateCmsPageRequestSchema`.

**What those shapes were.** The pre-014 CMS page projection: a page addressed by a single
globally unique `path`, with `title` and `body` as multilingual string maps. Feature 014
replaced it with the page-builder page — addressed by a **per-channel** slug, with its content
in a page-builder tree — and left the old shapes in place with one consumer each.

**Why they go now.** Neither consumer worked. The storefront's `getCmsPage` fetched
`GET /api/v1/cms/pages/{path}`, an endpoint no commit in this repository has ever registered, so
every URL it served resolved to a 404 the caller could not tell from an empty CMS; and the admin
screen typed against `CmsPage` posted `{ path, title, body }` to a route that parses
`createCmsPageRequestSchema`, which requires `name`, `slug`, `salesChannelIds` and `languages`.
The columns behind the shapes are still written and are still `@deprecated`: `path` is
`` `${slug}-${id.slice(0, 8)}` ``, `title` is a copy of `name` or `meta.title`, and `body` is `''`
for every page in every language. So an endpoint faithful to the old shape would address pages by
a URL no operator chose and return an empty document.

**What to use instead.** `cmsPageSummarySchema` / `CmsPageSummary` and `cmsPageDetailSchema` /
`CmsPageDetail` for the admin surface, `createCmsPageRequestSchema` and `patchCmsPageRequestSchema`
to write one, and `cmsResolvedPageSchema` / `CmsResolvedPage` for the storefront — the last is what
`GET /api/v1/cms/pages/by-slug` returns, with the language already resolved server-side and
embedded blocks and templates inlined.

**Two names survive the file and are not part of the break.** `cmsPageStatusSchema` and
`CmsPageStatus` were declared in *both* files, identically
(`'draft' | 'published' | 'archived'`), and `cms-pages.js`' star export won the collision — which
is why `cms.ts` is re-exported by name rather than with a star. `cms.ts`' pair is now named on
that list, so both keep resolving, with the same shape, from the same barrel.
