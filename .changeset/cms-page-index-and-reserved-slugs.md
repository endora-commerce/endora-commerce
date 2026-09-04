---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-cms': minor
---

A shop can tell crawlers its CMS pages exist, and an operator is told where a page will live.

**`@endora-commerce/contracts`** gains four names, all additive:

- `cmsPageIndexEntrySchema` / `CmsPageIndexEntry` and `cmsPageIndexResponseSchema` /
  `CmsPageIndexResponse` — `{ pages: [{ slug, updatedAt }] }`, the shape of
  `GET /api/v1/cms/pages/by-channel`. `slug` is the **per-channel** slug from
  `cms_page_sales_channels`, never `cms_pages.slug`: the address is per channel
  (Constitution XII) and the page row's own column is one value shared by all of them.
- `cmsReservedSegmentsResponseSchema` / `CmsReservedSegmentsResponse` — the deployment's
  reserved first path segments, normalised.
- `firstSlugSegment(slug)` — the first path segment of a CMS page slug, lowercased.
  `cmsSlugRe` permits `/`, so `pomoc/dostawa` is one page and its first segment is `pomoc`.
  It is published because **two** programs ask that question and must agree: the backend
  refusing a save, and the page editor warning while an operator types.
- `ERROR_CODES.CMS_SLUG_RESERVED`.

**`@endora-commerce/mod-cms`** gains two endpoints, a Setting and a refusal:

```
GET /api/v1/cms/pages/by-channel            # storefront, channel-scoped, published-only
GET /api/v1/admin/cms/pages/reserved-segments   # admin, `cms.read`
```

The first is what a sitemap is built from. Until now the reference storefront advertised **no
CMS URL to any crawler at all** — its `SITEMAP_DYNAMIC_ROUTES` named the route *pattern*, which
is a declaration for the indexability check's reconciliation and says nothing about the rows
behind it. Both routes are registered inside the module's existing `ctx.routes` seam, so both
answer `503 MODULE_DISABLED` while `cms` is switched off and the storefront's sitemap then
advertises no CMS URL and still serves.

The Setting is `cms.reserved_slug_segments` — `valueType: 'json'`, `defaultValue: []`, in the
existing `cms` group. A CMS page is served at the storefront root, `/{slug}`, so a page slugged
`cart` saves, publishes and is never shown: a root catch-all is Next's lowest-priority match and
the storefront's own `/cart` wins. **Nothing in this change creates that precedence**; what it
removes is the silence. `CmsPageService.create` and `.patch` refuse a slug whose first segment
the deployment reserves, with `409 CMS_SLUG_RESERVED` carrying `details.segment`, and the page
editor reads the same value and warns inline while the operator types. A patch that writes no
slug is not refused, so a page whose slug predates the reserved set stays editable.

**The default is empty and that is not a gap.** The set is a fact about a *storefront's route
table*; a headless backend serves storefronts it did not build, so a list shipped inside `cms`
would be a derived fact about a consumer written into the owner. The reference storefront
publishes its own as `RESERVED_TOP_LEVEL_SEGMENTS` in `storefront/app/reserved-segments.ts`,
reconciled against its route tree in both directions by `check:storefront-indexability`; a
deployment copies its value from there.

Nothing is removed and no existing shape changes.
