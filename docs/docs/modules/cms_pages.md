---
title: cms_pages
---

# `cms_pages`

Editorial pages authored by Admin Users (T234 / FR-100). Each page has a
unique kebab-case `path`, multilingual `title` and `body`, and a simple
draft → published → archived lifecycle.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/cms/pages/*` | storefront / crawlers | Returns the published page at the given path; 404 for drafts and archived rows |
| `GET /api/v1/admin/cms/pages` | admin (`catalog:write`) | List all pages incl. drafts |
| `GET /api/v1/admin/cms/pages/:id` | admin | Single row |
| `POST /api/v1/admin/cms/pages` | admin | Create draft |
| `PATCH /api/v1/admin/cms/pages/:id` | admin | Update title/body in place |
| `POST /api/v1/admin/cms/pages/:id/publish` | admin | Flip to `published` and stamp `publishedAt` |
| `POST /api/v1/admin/cms/pages/:id/unpublish` | admin | Flip back to `draft` |
| `POST /api/v1/admin/cms/pages/:id/archive` | admin | Soft-archive |
| `DELETE /api/v1/admin/cms/pages/:id` | admin | Hard delete |

## Lifecycle

`draft → published → (unpublish | archive)`. Public reads only return rows
with `status='published'`. The path is mutable; the unique constraint
catches collisions and the service returns `409 VALIDATION_FAILED`.

## Path shape

`path` matches `^[a-z0-9]+(?:[/\-][a-z0-9]+)*$` — single-segment kebab
(`about-us`) or nested (`policies/privacy`). Validation lives in the
contract Zod schema and again in the public route handler so a malformed
URL never reaches the service.

## SEO + sitemap integration

The [`seo`](./seo) module's resolver and sitemap consume CMS pages:

- `MetaTagResolverService.resolve({ entityType: 'cms_page', entityId, locale })`
  returns rule-derived title/description from the page's multilingual
  fields, with editorial overrides via the standard `seo_meta_overrides`
  table.
- `SitemapGeneratorService.regenerate()` emits one URL per published CMS
  page at `${baseUrl}/${path}` with priority 0.5 and a monthly changefreq.

## Entities

`CmsPage` — `id`, `path` (unique), `status`, `title` (JSONB), `body`
(JSONB), `publishedAt`, `archivedAt`, timestamps.

## Extension points

- **Structured blocks** — today `body` is a free-form multilingual string
  (Markdown by convention). For richer page composition, swap the column
  for a typed block list and extend the resolver / serializer.
- **Reusable content blocks** — FR-100 mentions "Product content blocks
  (rich description, gallery, documents)". Implement them as their own
  module with M:N references from `CmsPage` and `Product`.
- **Versioning / drafts on top of published** — current model overwrites
  `body` in place. For an editorial workflow with side-by-side draft +
  published, add a `cms_page_drafts` table and merge on publish.
