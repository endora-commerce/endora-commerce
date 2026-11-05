---
'@endora-commerce/mod-blog': patch
---

Blog storefront pages no longer slow the whole site down (issue #685).

Every card image, category image and author avatar on a blog page was resolved through
`AssetsLibraryPort.getAsset`, whose admin detail builds the asset's "used by" list by walking the
content of every CMS page, block, template, blog post, product and menu — seconds per image on a
site with real content, on every blog request, cached or not. The blog now asks
`AssetReadPort.resolvePublicUrls` instead: one keyed read, the same URL. An asset in the trash no
longer yields a storefront image.
