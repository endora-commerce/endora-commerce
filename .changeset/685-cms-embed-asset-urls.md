---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-assets-library': minor
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-pwa': patch
---

Page Builder pages, hooks and menus no longer saturate the database on a cache miss (issue #685).

`cms` turned every asset a page, block, template or hook embeds into a URL through
`AssetsLibraryPort.getAsset`, one call per embed. The detail it builds carries the asset's "used by"
list, which walks the content of every CMS page, block and template, blog post, product and menu — so a
home page with ~150 images ran that walk ~150 times whenever its cache expired, and every other request
waited behind it. `megamenu` (asset targets and icons) and `pwa` (icon redirects) made the same call.

`@endora-commerce/contracts`: `AssetReadPort.resolveUrls(assetIds)` — the URL `getAsset` would carry
for each live asset (versioned for a public one, signed for a private one), in one read, keyed by id;
an id that names no live asset, or is not a uuid, is absent. **An implementer of `AssetReadPort` must
add it.** `@endora-commerce/mod-assets-library` implements it.

`cms` now resolves a whole page, block, template or hook in two keyed reads (`resolveUrls`, then
`findByIds` for the ids that have a URL); `megamenu` and `pwa` take the URL from `resolveUrls`.
Rendered output is unchanged, except that an asset in the trash no longer renders.
