---
title: seo
description: Meta-tag resolver + cached XML sitemap
---

# `seo`

Per-page meta-tag resolution and the public XML sitemap.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/catalog/sitemap.xml` | crawlers | Cached XML sitemap; falls through to inline regenerate when stale |
| `POST /api/v1/admin/seo/sitemap/regenerate` | admin (`catalog:write`) | Force a fresh build |
| `GET /api/v1/admin/seo/sitemap/status` | admin | Last-generated timestamp + size + URL count |
| `GET /api/v1/admin/seo/meta/:entityType/:entityId` | admin | Resolved meta + override row for a (entity, locale) |
| `PUT /api/v1/admin/seo/meta/:entityType/:entityId` | admin | Upsert override (per locale) |
| `DELETE /api/v1/admin/seo/meta/:entityType/:entityId` | admin | Drop the override (resolver returns to rule output) |

## Meta-tag resolution

`MetaTagResolverService.resolve({ entityType, entityId, locale })` returns
`{ title, description, openGraph, source, locale }`. The resolution order is:

1. Look up the per-(entity, locale) override row.
2. If a field is set on the override, use it verbatim.
3. Otherwise fall back to the rule derived from the entity (Product name +
   description, Category name + auto-summary).
4. Per-field locale fallback: when a Product has no `pl-PL` text, the rule
   uses `en-US`, then any available locale.

Title and description are truncated at 60 / 160 characters with an ellipsis.
The truncation lives in one helper so changes to the SEO budget happen in
one place.

## Sitemap

`SitemapGeneratorService.regenerate()` walks active, public-visibility,
non-archived products and non-deleted categories, stamps absolute URLs
against `STOREFRONT_BASE_URL`, and writes the XML payload to a singleton
`sitemap_cache` row.

The public route (`GET /catalog/sitemap.xml`) returns the cached payload;
when the row is older than `staleAfterMs` (default 6 h) it regenerates
inline. A `Cache-Control: public, max-age=3600` header is set on the
response so well-behaved CDNs hold the payload for an hour.

## Anonymous-only filtering

The sitemap excludes:
- products with `status != 'active'`
- products with `visibility != 'public'`
- archived (`archivedAt`) and soft-deleted (`deletedAt`) rows
- soft-deleted categories

The contract is simple: only what an anonymous Customer can see is
ever exposed to crawlers.

## Entities

`SeoMetaOverride` (entityType, entityId, locale, title?, description?,
ogTitle?, ogDescription?, ogImageUrl?), `SitemapCache` (singleton key,
payload, urlCount, byteSize, generatedAt).

## Extension points

- **CMS pages** — when a CMS module ships, hook its slug + body into both
  `MetaTagResolverService.loadRuleSource()` and
  `SitemapGeneratorService.regenerate()`.
- **Sitemap index** — for catalogues > 50 000 URLs, split into per-section
  sitemaps and emit a `<sitemapindex>` from this module's route.
- **Scheduled regenerate** — wire a BullMQ repeatable into the production
  composition root that calls `regenerate()` nightly.
